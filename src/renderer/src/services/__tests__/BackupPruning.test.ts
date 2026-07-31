import { describe, expect, it } from 'vitest'

import {
  getAppMigrationBackupFilesToDelete,
  getLocalBackupFilesToDelete,
  getRemotePortableBackupFilesToDelete
} from '../BackupService'

describe('Backup Pruning Logic', () => {
  describe('getLocalBackupFilesToDelete', () => {
    it('keeps the newest local backups even when host or device names change', () => {
      const files = [
        {
          fileName: 'cherry-studio.20260510090000.alpha.laptop.zip',
          modifiedTime: '2026-05-10T09:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.20260510080000.beta.desktop.zip',
          modifiedTime: '2026-05-10T08:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.20260510070000.gamma.tablet.zip',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.sync.zip',
          modifiedTime: '2026-05-10T10:00:00.000Z',
          size: 100
        }
      ]

      // Should keep 2 newest backups matching pattern, ignore sync.zip
      // Newest: 09:00, 08:00
      // Oldest to delete: 07:00
      expect(getLocalBackupFilesToDelete(files, 2)).toEqual([
        {
          fileName: 'cherry-studio.20260510070000.gamma.tablet.zip',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        }
      ])
    })
  })

  describe('getRemotePortableBackupFilesToDelete', () => {
    it('correctly filters and prunes remote portable backups', () => {
      const files = [
        {
          fileName: 'cherry-studio.20260510090000.alpha.laptop.zip',
          modifiedTime: '2026-05-10T09:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.20260510080000.beta.desktop.zip',
          modifiedTime: '2026-05-10T08:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.20260510070000.gamma.tablet.zip',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.backup.zip',
          modifiedTime: '2026-05-10T10:00:00.000Z',
          size: 100
        }
      ]

      // Remote helper ignores .backup.zip, sees 3 files, deletes oldest (07:00)
      expect(getRemotePortableBackupFilesToDelete(files, 2)).toEqual([
        {
          fileName: 'cherry-studio.20260510070000.gamma.tablet.zip',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        }
      ])
    })
  })

  describe('getAppMigrationBackupFilesToDelete', () => {
    it('correctly filters and prunes mobile sync (app) backups separately', () => {
      const files = [
        // PC Backups (should be ignored by this helper)
        {
          fileName: 'cherry-studio.20260510090000.laptop.zip',
          modifiedTime: '2026-05-10T09:00:00.000Z',
          size: 100
        },
        // App Backups
        {
          fileName: 'cherry-studio.mobile-sync.20260510080000.laptop.json',
          modifiedTime: '2026-05-10T08:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.mobile-sync.20260510070000.laptop.json',
          modifiedTime: '2026-05-10T07:00:00.000Z',
          size: 100
        },
        {
          fileName: 'cherry-studio.mobile-sync.20260510060000.laptop.json',
          modifiedTime: '2026-05-10T06:00:00.000Z',
          size: 100
        }
      ]

      // With maxBackups = 2, it should delete the oldest app backup (06:00:00)
      // and ignore the PC backup (09:00:00)
      const result = getAppMigrationBackupFilesToDelete(files, 2)

      expect(result).toEqual([
        {
          fileName: 'cherry-studio.mobile-sync.20260510060000.laptop.json',
          modifiedTime: '2026-05-10T06:00:00.000Z',
          size: 100
        }
      ])
    })
  })

  // Regression: manual remote-upload paths used to pass an EMPTY device context
  // ({ deviceType: '', hostname: '' }) into the pruning helpers, falling into the
  // global branch and counting OTHER devices' portable backups against this
  // device's maxBackups quota. That deleted archives belonging to other devices
  // once their combined count exceeded the local quota. They must now pass the
  // real device context (scheduled-upload behaviour) so only this device prunes.
  describe('device-context regression: only prune this device, never foreign archives', () => {
    const thisDevice = { deviceType: 'windows', hostname: 'Herselfta' }
    const foreignHost = 'Pursuits-End.local.mac'

    // Mirrors the real WebDAV layout observed on 2026-07-31: the oldest portable
    // archive belongs to THIS device (Herselfta/windows, 07-18), then 44 newer
    // Herselfta archives + 6 foreign mac archives, totalling 51 against a quota of
    // 50. All modifiedTimes are strictly increasing so "oldest" is unambiguous.
    const realWorldFiles = () => {
      const files: Array<{ fileName: string; modifiedTime: string; size: number }> = []
      // Oldest — this device — the one the buggy global branch wrongly deletes.
      files.push({
        fileName: 'cherry-studio.migration.20260718145829.Herselfta.windows.zip',
        modifiedTime: '2026-07-18T14:58:53.000Z',
        size: 100
      })
      // 44 newer Herselfta archives (07-19 .. spacing by hour).
      for (let i = 0; i < 44; i++) {
        const d = new Date(Date.UTC(2026, 6, 19, 0, i, 0))
        const ts = d
          .toISOString()
          .replace(/[-:T.Z]/g, '')
          .slice(0, 14)
        files.push({
          fileName: `cherry-studio.migration.${ts}.Herselfta.windows.zip`,
          modifiedTime: d.toISOString(),
          size: 100
        })
      }
      // 6 foreign mac archives, all newer than the Herselfta ones.
      for (let i = 0; i < 6; i++) {
        const d = new Date(Date.UTC(2026, 6, 27, i, 0, 0))
        const ts = d
          .toISOString()
          .replace(/[-:T.Z]/g, '')
          .slice(0, 14)
        files.push({
          fileName: `cherry-studio.migration.${ts}.${foreignHost}.mac.zip`,
          modifiedTime: d.toISOString(),
          size: 100
        })
      }
      return files
    }

    it('real device context: does NOT prune when this device (45) is under quota (50), leaves foreign archives untouched', () => {
      const toDelete = getRemotePortableBackupFilesToDelete(realWorldFiles(), 50, thisDevice)
      expect(toDelete).toEqual([])
    })

    it('empty context (the regressed manual-upload path): would delete the THIS-device oldest archive by miscounting foreign ones', () => {
      // 51 total > 50 => the global branch deletes one — the single oldest — which
      // is the Herselfta 07-18 file. This documents why empty context is wrong: it
      // deletes a THIS-device file that the real-context branch correctly keeps.
      const buggy = getRemotePortableBackupFilesToDelete(realWorldFiles(), 50, { deviceType: '', hostname: '' })
      expect(buggy.length).toBe(1)
      expect(buggy[0].fileName).toBe('cherry-studio.migration.20260718145829.Herselfta.windows.zip')
    })

    it('app (mobile-sync) cleanup is also gated by real device context', () => {
      const files: Array<{ fileName: string; modifiedTime: string; size: number }> = []
      files.push({
        fileName: 'cherry-studio.mobile-sync.20260718145829.Herselfta.windows.json',
        modifiedTime: '2026-07-18T14:58:53.000Z',
        size: 100
      })
      for (let i = 0; i < 44; i++) {
        const d = new Date(Date.UTC(2026, 6, 19, 0, i, 0))
        const ts = d
          .toISOString()
          .replace(/[-:T.Z]/g, '')
          .slice(0, 14)
        files.push({
          fileName: `cherry-studio.mobile-sync.${ts}.Herselfta.windows.json`,
          modifiedTime: d.toISOString(),
          size: 100
        })
      }
      for (let i = 0; i < 6; i++) {
        const d = new Date(Date.UTC(2026, 6, 27, i, 0, 0))
        const ts = d
          .toISOString()
          .replace(/[-:T.Z]/g, '')
          .slice(0, 14)
        files.push({
          fileName: `cherry-studio.mobile-sync.${ts}.${foreignHost}.mac.json`,
          modifiedTime: d.toISOString(),
          size: 100
        })
      }
      expect(getAppMigrationBackupFilesToDelete(files, 50, thisDevice)).toEqual([])
      const buggy = getAppMigrationBackupFilesToDelete(files, 50, { deviceType: '', hostname: '' })
      expect(buggy).toHaveLength(1)
      expect(buggy[0].fileName).toBe('cherry-studio.mobile-sync.20260718145829.Herselfta.windows.json')
    })
  })
})
