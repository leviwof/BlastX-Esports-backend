import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { RecordingsService } from './recordings.service';
import { InitRecordingDto } from './dto/init-recording.dto';
import { CompleteRecordingDto } from './dto/complete-recording.dto';
import { ProgressRecordingDto } from './dto/progress-recording.dto';

@Controller(['recordings', 'v1/recordings', 'api/recordings'])
@UseGuards(JwtAuthGuard)
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  /**
   * GET /v1/recordings/:id/upload-session
   * Owner only - gets or refreshes upload session.
   */
  @Get(':id/upload-session')
  async getUploadSession(
    @Param('id') recordingId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordingsService.getUploadSession(recordingId, user.sub);
  }

  /**
   * POST /v1/recordings/:id/complete
   * Owner only - verifies file with storage API and marks UPLOADED.
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async completeRecording(
    @Param('id') recordingId: string,
    @Body() dto: CompleteRecordingDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordingsService.completeRecording(
      recordingId,
      user.sub,
      dto,
    );
  }

  /**
   * POST /v1/recordings/:id/progress
   * Owner only - updates upload progress.
   */
  @Post(':id/progress')
  @HttpCode(HttpStatus.OK)
  async updateProgress(
    @Param('id') recordingId: string,
    @Body() dto: ProgressRecordingDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordingsService.updateProgress(recordingId, user.sub, dto);
  }

  /**
   * GET /v1/recordings/:id
   * Owner status only - strips fileUrl / secret session url.
   */
  @Get(':id')
  async getRecordingById(
    @Param('id') recordingId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordingsService.getRecordingById(recordingId, user.sub);
  }
}

@Controller(['tournaments', 'v1/tournaments', 'api/tournaments'])
@UseGuards(JwtAuthGuard)
export class TournamentRecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  /**
   * POST /v1/tournaments/:tid/matches/:matchKey/recordings
   * Initiates a resumable match recording upload session.
   */
  @Post(':tid/matches/:matchKey/recordings')
  async initRecording(
    @Param('tid') tournamentId: string,
    @Param('matchKey') matchKey: string,
    @Body() dto: InitRecordingDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordingsService.initRecording(
      tournamentId,
      matchKey,
      user.sub,
      dto,
    );
  }

  /**
   * GET /v1/tournaments/:tid/matches/:matchKey/my-recording
   * Gets current user's recording status for the match.
   */
  @Get(':tid/matches/:matchKey/my-recording')
  async getMyRecording(
    @Param('tid') tournamentId: string,
    @Param('matchKey') matchKey: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.recordingsService.getMyRecording(
      tournamentId,
      matchKey,
      user.sub,
    );
  }
}
