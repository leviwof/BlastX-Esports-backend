import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { TournamentBracketService } from './tournament-bracket.service';
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
import { OpenWildCardDto, AssignWildCardSlotDto } from './dto/wildcard.dto';
import {
  ResolveTieBreakerDto,
  AssembleGrandFinalDto,
  FillGrandFinalSlotDto,
  SetGroupRoomCredentialsDto,
} from './dto/bracket.dto';

@Controller('admin/tournaments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly bracketService: TournamentBracketService,
  ) {}

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

  // ==========================================
  // ROUND GENERATION & ADVANCEMENT
  // ==========================================

  @Post(':id/rounds/r1/generate')
  async generateRound1(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.bracketService.generateRound1(id, user.sub);
  }

  @Post(':id/rounds/r1/advance')
  async advanceRound1(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.bracketService.advanceRound1(id, user.sub);
  }

  @Post(':id/rounds/r2/advance')
  async advanceRound2(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.bracketService.advanceRound2(id, user.sub);
  }

  @Post(':id/rounds/r3/generate')
  async generateRound3(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.bracketService.generateRound3(id, user.sub);
  }

  @Post(':id/rounds/r3/advance')
  async advanceRound3(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.bracketService.advanceRound3(id, user.sub);
  }

  @Post(':id/rounds/grand-final/assemble')
  async assembleGrandFinal(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: AssembleGrandFinalDto,
  ) {
    return this.bracketService.assembleGrandFinal(id, dto.specialInviteTeamId, user.sub);
  }

  @Post(':id/rounds/grand-final/fill-slot')
  async fillGrandFinalSlot(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: FillGrandFinalSlotDto,
  ) {
    return this.bracketService.adminFillGrandFinalSlot(id, dto.teamId, dto.reason, user.sub);
  }

  // ==========================================
  // TIE BREAKER ENGINE
  // ==========================================

  @Get(':id/tie-breakers/pending')
  async getPendingTieBreakers(
    @Param('id') id: string,
  ) {
    return this.bracketService.getPendingTieBreakers(id);
  }

  @Post(':id/tie-breakers/:tieBreakerId/resolve')
  async resolveTieBreaker(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('tieBreakerId') tieBreakerId: string,
    @Body() dto: ResolveTieBreakerDto,
  ) {
    return this.bracketService.resolveTieBreaker(id, tieBreakerId, dto.selectedTeamId, user.sub);
  }

  // ==========================================
  // WILD CARD MANAGEMENT
  // ==========================================

  @Post(':id/wildcard/open')
  async openWildCard(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: OpenWildCardDto,
  ) {
    return this.bracketService.openWildCard(id, dto.entryFee, user.sub);
  }

  @Post(':id/wildcard/close')
  async closeWildCard(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.bracketService.closeWildCard(id, user.sub);
  }

  @Get(':id/wildcard/slots')
  async getWildCardSlots(
    @Param('id') id: string,
  ) {
    return this.bracketService.getWildCardSlots(id);
  }

  @Post(':id/wildcard/slots/assign')
  async assignWildCardSlot(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: AssignWildCardSlotDto,
  ) {
    return this.bracketService.adminAssignWildCardSlot(id, dto.teamId, dto.slotNumber, user.sub);
  }

  @Delete(':id/wildcard/slots/:slotNumber')
  async removeWildCardSlot(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('slotNumber') slotNumber: string,
  ) {
    return this.bracketService.adminRemoveWildCardSlot(id, parseInt(slotNumber, 10), user.sub);
  }

  // ==========================================
  // GROUP ROOM CREDENTIALS
  // ==========================================

  @Patch(':id/groups/:groupId/room-credentials')
  async setGroupRoomCredentials(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() dto: SetGroupRoomCredentialsDto,
  ) {
    return this.bracketService.updateGroupRoomCredentials(id, groupId, dto, user.sub);
  }

  @Get(':id/rounds')
  async getTournamentRounds(
    @Param('id') id: string,
  ) {
    return this.bracketService.getTournamentRounds(id);
  }

  @Post(':id/groups/:groupId/scores')
  async submitGroupScores(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() dto: { scores: Array<{ tournamentTeamId: string; kills: number; placement: number }> },
  ) {
    return this.bracketService.submitGroupScores(id, groupId, dto.scores || [], user.sub);
  }
}

