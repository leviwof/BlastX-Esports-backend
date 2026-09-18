import { Controller, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { UpdateTournamentStatusDto } from './dto/update-status.dto';
import { SetRoomCredentialsDto } from './dto/set-room.dto';
import { DisqualifyRegistrationDto } from './dto/disqualify.dto';
import { toTournamentResponse, toTournamentRegistrationResponse, TournamentResponse, TournamentRegistrationResponse } from './tournament.mapper';
import { UserRole } from '@prisma/client';

@Controller('admin/tournaments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Post()
  async createTournament(@CurrentUser() user: JwtUser, @Body() dto: CreateTournamentDto): Promise<TournamentResponse> {
    const tournament = await this.tournamentsService.createTournament(user.sub, dto);
    return toTournamentResponse(tournament, undefined, true);
  }

  @Patch(':id')
  async updateTournament(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateTournamentDto,
  ): Promise<TournamentResponse> {
    const tournament = await this.tournamentsService.updateTournament(user.sub, id, dto);
    return toTournamentResponse(tournament, undefined, true);
  }

  @Post(':id/status')
  async updateStatus(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateTournamentStatusDto,
  ): Promise<TournamentResponse> {
    const tournament = await this.tournamentsService.updateStatus(user.sub, id, dto.status);
    return toTournamentResponse(tournament, undefined, true);
  }

  @Post(':id/room')
  async setRoomCredentials(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetRoomCredentialsDto,
  ): Promise<TournamentResponse> {
    const tournament = await this.tournamentsService.setRoomCredentials(user.sub, id, dto);
    return toTournamentResponse(tournament, undefined, true);
  }

  @Post(':id/disqualify')
  async disqualifyRegistration(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: DisqualifyRegistrationDto,
  ): Promise<TournamentRegistrationResponse> {
    const registration = await this.tournamentsService.disqualifyRegistration(user.sub, id, dto);
    return toTournamentRegistrationResponse(registration);
  }
}
