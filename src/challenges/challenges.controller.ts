import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ChallengesService } from './challenges.service';
import { SubmitProofDto, UploadedProofFile } from './dto/submit-proof.dto';
import { ChallengeResponse, SubmitProofResponse } from './challenge.mapper';
import { ClaimChallengeResponseData } from '../common/rank-system';

@Controller('challenges')
@UseGuards(JwtAuthGuard)
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Get()
  async getChallenges(@CurrentUser() user: JwtUser): Promise<ChallengeResponse[]> {
    return this.challengesService.getChallenges(user.sub);
  }

  @Post(':id/claim')
  async claimChallenge(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<{ success: true; data: ClaimChallengeResponseData }> {
    return this.challengesService.claimChallenge(user.sub, id);
  }

  @Post(':id/submit-proof')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 120 * 1024 * 1024, // 120 MB max — supports a full 25-min Free Fire match at 480p/600Kbps (~107 MB)
      },
    }),
  )
  async submitProof(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedProofFile,
    @Body() dto: SubmitProofDto,
  ): Promise<SubmitProofResponse> {
    return this.challengesService.submitProof(user.sub, id, file, dto.resolution);
  }
}
