import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SubstitutesToggleDto } from './dto/substitutes-toggle.dto';
import { JoinTeamDto } from './dto/join-team.dto';
import { CreateTournamentTeamDto } from '../tournaments/dto/create-tournament-team.dto';

describe('Live Section DTO Validation Tests', () => {
  describe('SubstitutesToggleDto', () => {
    it('validates payload with accepting_substitutes and acceptingSubstitutes', async () => {
      const payload = {
        accepting_substitutes: true,
        acceptingSubstitutes: true,
      };
      const dto = plainToInstance(SubstitutesToggleDto, payload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('validates payload with only accepting_substitutes', async () => {
      const payload = { accepting_substitutes: false };
      const dto = plainToInstance(SubstitutesToggleDto, payload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('JoinTeamDto', () => {
    it('validates payload with rosterType and nested player object', async () => {
      const payload = {
        invite_code: 'BLX7K29',
        as_substitute: false,
        rosterType: 'MAIN',
        player: {
          name: 'Amit Kumar',
          ign: 'BLX_Amit',
          uid: '887766554',
        },
      };
      const dto = plainToInstance(JoinTeamDto, payload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.rosterType).toBe('MAIN');
      expect(dto.player?.ign).toBe('BLX_Amit');
    });
  });

  describe('CreateTournamentTeamDto', () => {
    it('validates payload with player object and empty logo_url', async () => {
      const payload = {
        name: 'BLX Warriors',
        tag: 'BLX',
        logo_url: '',
        accepting_substitutes: true,
        player: {
          name: 'Rahul Verma',
          ign: 'BLX_Rahul',
          uid: '109823471',
        },
      };
      const dto = plainToInstance(CreateTournamentTeamDto, payload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.player?.uid).toBe('109823471');
    });

    it('validates payload with valid URL for logo_url', async () => {
      const payload = {
        name: 'BLX Warriors',
        tag: 'BLX',
        logo_url: 'https://example.com/logo.png',
        accepting_substitutes: true,
      };
      const dto = plainToInstance(CreateTournamentTeamDto, payload);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
