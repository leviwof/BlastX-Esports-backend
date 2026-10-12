import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';
import { RecordingsService } from './recordings.service';
import { ListAdminRecordingsQuery } from './dto/list-admin-recordings.query';

@Controller(['admin/tournaments', 'v1/admin/tournaments', 'api/admin/tournaments'])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTournamentRecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  /**
   * GET /v1/admin/tournaments/:id/recordings
   */
  @Get(':id/recordings')
  async listRecordings(
    @Param('id') tournamentId: string,
    @Query() query: ListAdminRecordingsQuery,
  ) {
    return this.recordingsService.listAdminRecordings(tournamentId, query);
  }
}

@Controller(['admin/recordings', 'v1/admin/recordings', 'api/admin/recordings'])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminRecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  /**
   * GET /v1/admin/recordings/:id
   */
  @Get(':id')
  async getRecordingById(@Param('id') recordingId: string) {
    return this.recordingsService.getAdminRecordingById(recordingId);
  }

  /**
   * GET /v1/admin/recordings/:id/stream
   * Authenticated video stream for admins with Range header support.
   */
  @Get(':id/stream')
  async streamRecording(
    @Param('id') recordingId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.recordingsService.streamRecording(recordingId, req, res);
  }

  /**
   * PATCH /v1/admin/recordings/:id
   * Admin can flag keep=true and add review notes
   */
  @Patch(':id')
  async updateRecording(
    @Param('id') recordingId: string,
    @Body() body: { keep?: boolean; review_note?: string },
    @Req() req: any,
  ) {
    return this.recordingsService.updateAdminRecording(recordingId, {
      keep: body?.keep,
      review_note: body?.review_note,
      reviewed_by: req.user?.id || req.user?.sub,
    });
  }
}

