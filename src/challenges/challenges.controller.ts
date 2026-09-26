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
  ): Promise<ChallengeResponse> {
    return this.challengesService.claimChallenge(user.sub, id);
  }

  @Post(':id/submit-proof')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 60 * 1024 * 1024, // 60MB max
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
