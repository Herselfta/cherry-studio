import type { BackupArtifactType } from '@renderer/components/BackupTypeModal'

export const LEGACY_PORTABLE_BACKUP_FILE_NAME = 'cherry-studio.sync.zip'
export const PC_MIGRATION_BACKUP_MARKER = '.migration.'
export const PC_DIRECT_BACKUP_MARKER = '.backup.'
export const PC_DIRECT_BACKUP_FILE_NAME = 'cherry-studio.backup.zip'
export const MOBILE_SYNC_BACKUP_MARKER = '.mobile-sync.'

export async function buildBackupArtifactFileName(artifactType: BackupArtifactType) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14)
  const [hostname, deviceType] = await Promise.all([
    window.api.system.getHostname().catch(() => 'desktop'),
    window.api.system.getDeviceType().catch(() => 'desktop')
  ])

  if (artifactType === 'app') {
    // APP artifacts are portable shared-data payloads, not desktop restore archives.
    return `cherry-studio${MOBILE_SYNC_BACKUP_MARKER}${timestamp}.${hostname || 'desktop'}.${deviceType || 'desktop'}.json`
  }

  // PC artifacts keep the migration naming so restore pickers can distinguish them
  // from APP sync JSON even though both now share the same selection modal.
  return `cherry-studio${PC_MIGRATION_BACKUP_MARKER}${timestamp}.${hostname || 'desktop'}.${deviceType || 'desktop'}.zip`
}

/**
 * Resolve the current device's hostname + deviceType for device-aware pruning.
 *
 * The filename written at upload time (buildBackupArtifactFileName) embeds the
 * same hostname/deviceType, and the device-aware pruning filter
 * (getRemotePortableBackupFilesToDelete / getAppMigrationBackupFilesToDelete)
 * must match it via `fileName.includes(hostname)` etc. Without passing real
 * values here, pruning falls into the global branch and counts OTHER devices'
 * backups against this device's maxBackups quota, deleting archives that
 * don't belong to the current device. Falls back to 'unknown' (never throws)
 * to match BackupService's long-standing convention.
 */
export async function resolveDeviceContext(): Promise<{ hostname: string; deviceType: string }> {
  const [hostname, deviceType] = await Promise.all([
    window.api.system.getHostname().catch(() => 'unknown'),
    window.api.system.getDeviceType().catch(() => 'unknown')
  ])
  return { hostname: hostname || 'unknown', deviceType: deviceType || 'unknown' }
}

export function isMobileSyncArtifactFile(fileName: string) {
  return (
    fileName.startsWith('cherry-studio') && fileName.endsWith('.json') && fileName.includes(MOBILE_SYNC_BACKUP_MARKER)
  )
}

export function isStrictPcMigrationArtifactFile(fileName: string) {
  return fileName.includes(PC_MIGRATION_BACKUP_MARKER) || fileName === LEGACY_PORTABLE_BACKUP_FILE_NAME
}

export function isDirectPcSnapshotArtifactFile(fileName: string) {
  return fileName === PC_DIRECT_BACKUP_FILE_NAME || fileName.includes(PC_DIRECT_BACKUP_MARKER)
}

export function isRemotePortablePcArtifactFile(fileName: string) {
  // Remote providers only support the portable PC restore flow, but older uploads
  // predate the explicit `.migration.` marker. Keep this broader than the local
  // classifier so WebDAV / Nutstore / S3 can still list and restore those legacy
  // archives. Do not tighten this back to `.migration.` only, or historical scheduled
  // uploads disappear from both the restore UI and scheduled restore logic.
  return fileName.startsWith('cherry-studio') && fileName.endsWith('.zip') && !isDirectPcSnapshotArtifactFile(fileName)
}
