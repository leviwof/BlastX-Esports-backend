import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../common/public.decorator';
import { ChallengesService } from './challenges.service';

@Controller(['proofs', 'api/proofs', 'v1/proofs'])
export class ProofsController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Public()
  @Get('stream/:fileId')
  async streamProofVideo(
    @Param('fileId') fileId: string,
    @Query('token') tokenQueryParam: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.challengesService.streamProofVideo(fileId, req, res, tokenQueryParam);
  }
}
