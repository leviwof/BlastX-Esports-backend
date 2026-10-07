import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
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
import { FilterTournamentQueryDto } from './dto/filter-tournament.dto';

@Controller('admin/tournaments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  /** Includes DRAFT/CANCELLED events, unlike the player-facing catalogue. */
  @Get()
  async getTournaments(@Query() query: FilterTournamentQueryDto) {
    const result = await this.tournamentsService.getTournaments(query, undefined, true);
    return {
      ...result,
      items: result.items.map((item) => toTournamentResponse(item, undefined, true)),
    };
  }

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

  @Delete(':id')
  async deleteTournament(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.tournamentsService.deleteTournament(user.sub, id);
  }

  @Post(':id/delete')
  async deleteTournamentPost(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.tournamentsService.deleteTournament(user.sub, id);
  }

  @Post([':id/room', ':id/room-details'])
  async setRoomCredentials(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetRoomCredentialsDto,
  ): Promise<TournamentResponse & { success: true; message: string }> {
    const tournament = await this.tournamentsService.setRoomCredentials(user.sub, id, dto);
    return {
      ...toTournamentResponse(tournament, undefined, true),
      success: true,
      message: 'Room details published successfully',
    };
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
