import { MatchRecording, RecordingStatus } from '@prisma/client';

export interface PlayerRecordingResponse {
  id: string;
  client_recording_id: string;
  tournament_id: string;
  team_id: string | null;
  user_id: string;
  match_key: string;
  status: RecordingStatus;
  size_bytes: number | null;
  uploaded_bytes: number;
  duration_seconds: number | null;
  mime_type: string | null;
  resolution: string | null;
  started_at: string;
  stopped_at: string;
  device_model: string | null;
  app_version: string | null;
  failure_reason: string | null;
  created_at: string;
  uploaded_at: string | null;
}

export interface AdminRecordingResponse extends PlayerRecordingResponse {
  storage_provider: string | null;
  storage_file_id: string | null;
  file_url: string | null;
  keep: boolean;
  deleted_at: string | null;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  team?: {
    id: string;
    name: string;
    tag: string;
  } | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export function toPlayerRecordingResponse(
  recording: MatchRecording,
): PlayerRecordingResponse {
  return {
    id: recording.id,
    client_recording_id: recording.clientRecordingId,
    tournament_id: recording.tournamentId,
    team_id: recording.teamId,
    user_id: recording.userId,
    match_key: recording.matchKey,
    status: recording.status,
    size_bytes: recording.sizeBytes ? Number(recording.sizeBytes) : null,
    uploaded_bytes: Number(recording.uploadedBytes || 0),
    duration_seconds: recording.durationSeconds,
    mime_type: recording.mimeType,
    resolution: recording.resolution,
    started_at: recording.startedAt.toISOString(),
    stopped_at: recording.stoppedAt.toISOString(),
    device_model: recording.deviceModel,
    app_version: recording.appVersion,
    failure_reason: recording.failureReason,
    created_at: recording.createdAt.toISOString(),
    uploaded_at: recording.uploadedAt ? recording.uploadedAt.toISOString() : null,
  };
}

export function toAdminRecordingResponse(
  recording: MatchRecording & {
    user?: { id: string; name: string; email: string };
    team?: { id: string; name: string; tag: string } | null;
  },
): AdminRecordingResponse {
  const base = toPlayerRecordingResponse(recording);
  return {
    ...base,
    storage_provider: recording.storageProvider,
    storage_file_id: recording.storageFileId,
    file_url: recording.fileUrl,
    keep: recording.keep,
    deleted_at: recording.deletedAt ? recording.deletedAt.toISOString() : null,
    user: recording.user
      ? {
          id: recording.user.id,
          name: recording.user.name,
          email: recording.user.email,
        }
      : undefined,
    team: recording.team
      ? {
          id: recording.team.id,
          name: recording.team.name,
          tag: recording.team.tag,
        }
      : null,
    reviewed_by: recording.reviewedBy,
    reviewed_at: recording.reviewedAt ? recording.reviewedAt.toISOString() : null,
    review_note: recording.reviewNote,
  };
}
