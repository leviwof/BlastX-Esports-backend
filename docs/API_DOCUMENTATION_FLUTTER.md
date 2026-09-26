# BlastX Esports - Mobile App Developer API Reference

This document provides the complete API specification with exact Request parameters, Headers, and Response JSON contracts for the **BlastX Esports Flutter App**.

---

## 1. Global Configuration & Base URL

- **Production Base URL**: `https://blastx-esports-backend-production-4b5f.up.railway.app/v1`
- **Local Dev Base URL**: `http://localhost:3000/v1`
- **Standard Request Headers**:
  ```http
  Content-Type: application/json
  Accept: application/json
  Authorization: Bearer <USER_JWT_TOKEN>
  ```
- **Standard Response Envelope**: All successful responses are returned in a standard envelope:
  ```json
  {
    "status": "success",
    "data": { ... }
  }
  ```

---

## 2. Profile Section APIs

### 2.1 Get Authenticated User Profile & Live Statistics
- **Method**: `GET`
- **Endpoint**: `/users/me`
- **Auth**: `Bearer <token>`
- **Description**: Returns basic user details alongside live computed esports stats (`tournaments_played`, `tournaments_won`, `total_kills`, `win_rate`, `xp`, `rank`) and embedded primary game profile.
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": "cuid_user_123",
    "name": "Alex Mercer",
    "email": "alex.mercer@gmail.com",
    "profile_pic": "https://storage.blastx.com/profiles/user_123.jpg",
    "role": "PLAYER",
    "is_active": true,
    "created_at": "2024-01-15T10:30:00.000Z",
    "tournaments_played": 14,
    "tournaments_won": 5,
    "total_kills": 98,
    "win_rate": "35.7%",
    "xp": 3200,
    "rank": 12,
    "game_profile": {
      "id": "gp_9988",
      "game_slug": "free_fire",
      "game_name": "Free Fire",
      "in_game_uid": "512839401",
      "in_game_name": "ProGamer_X"
    }
  }
}
```

---

### 2.2 Update User Profile
- **Method**: `PATCH`
- **Endpoint**: `/users/me`
- **Auth**: `Bearer <token>`
- **Request Body**:
```json
{
  "name": "Alex 'Sniper' Mercer",
  "profile_pic": "https://storage.blastx.com/profiles/avatar_new.jpg"
}
```
- **Response `200 OK`**: Returns the updated user profile object with fresh statistics.

---

### 2.3 Get User Game Profile
- **Method**: `GET`
- **Endpoint**: `/users/me/game-profile?game_slug=free_fire`
- **Auth**: `Bearer <token>`
- **Query Parameters**: `game_slug` (string, optional, default: `"free_fire"`)
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": "gp_9988",
    "user_id": "cuid_user_123",
    "game_id": "game_ff_id",
    "game_slug": "free_fire",
    "in_game_uid": "512839401",
    "in_game_name": "ProGamer_X",
    "created_at": "2024-01-15T11:00:00.000Z",
    "updated_at": "2024-01-15T11:00:00.000Z"
  }
}
```

---

### 2.4 Register or Update Game Profile
- **Method**: `POST` (or `PUT`)
- **Endpoint**: `/users/me/game-profile`
- **Auth**: `Bearer <token>`
- **Request Body**:
```json
{
  "game_slug": "free_fire",
  "in_game_uid": "512839401",
  "in_game_name": "ProGamer_X"
}
```
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": "gp_9988",
    "user_id": "cuid_user_123",
    "game_id": "game_ff_id",
    "game_slug": "free_fire",
    "in_game_uid": "512839401",
    "in_game_name": "ProGamer_X",
    "created_at": "2024-01-15T11:00:00.000Z",
    "updated_at": "2024-01-15T11:00:00.000Z"
  }
}
```

---

### 2.5 Get User's Registered Tournaments (Sync API)
- **Method**: `GET`
- **Endpoint**: `/tournaments/me`
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": [
    {
      "id": "tourney_123",
      "title": "Free Fire Max India Cup",
      "status": "LIVE",
      "is_registered": true,
      "registration_status": "CONFIRMED"
    }
  ]
}
```

---

## 3. Challenges Section APIs

### 3.1 Get All Challenges (Active & User Progress)
- **Method**: `GET`
- **Endpoint**: `/challenges`
- **Auth**: `Bearer <token>`
- **Description**: Fetches all available challenges merged with the authenticated user's current progress and claim status.
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": [
    {
      "id": "c1",
      "title": "First Blood",
      "description": "Get 5 kills in Battle Royale mode.",
      "reward_xp": 100,
      "current_progress": 0.0,
      "target_progress": 5.0,
      "game": "Free Fire",
      "type": "DAILY",
      "is_completed": false,
      "is_claimed": false,
      "requires_recording": true,
      "game_package": "com.dts.freefireth",
      "icon_asset": "assets/icons/kill.png",
      "status": "ACTIVE"
    },
    {
      "id": "c2",
      "title": "Booyah Hunter",
      "description": "Win 1 match in Battle Royale / Clash Squad.",
      "reward_xp": 500,
      "current_progress": 1.0,
      "target_progress": 1.0,
      "game": "Free Fire",
      "type": "WEEKLY",
      "is_completed": true,
      "is_claimed": false,
      "requires_recording": true,
      "game_package": "com.dts.freefireth",
      "icon_asset": "assets/icons/trophy.png",
      "status": "COMPLETED"
    }
  ]
}
```

---

### 3.2 Claim Challenge Reward (XP Claim)
- **Method**: `POST`
- **Endpoint**: `/challenges/{id}/claim`
- **Path Parameter**: `id` -> Challenge ID (e.g. `c1`, `c2`)
- **Auth**: `Bearer <token>`
- **Description**: Claims XP for a completed challenge. Credits `reward_xp` to the user's account and locks the challenge as `CLAIMED`.
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": "c2",
    "title": "Booyah Hunter",
    "description": "Win 1 match in Battle Royale / Clash Squad.",
    "reward_xp": 500,
    "current_progress": 1.0,
    "target_progress": 1.0,
    "game": "Free Fire",
    "type": "WEEKLY",
    "is_completed": true,
    "is_claimed": true,
    "requires_recording": true,
    "game_package": "com.dts.freefireth",
    "icon_asset": "assets/icons/trophy.png",
    "status": "CLAIMED"
  }
}
```
- **Error `400 Bad Request`**: If already claimed or not yet completed:
```json
{
  "status": "error",
  "message": "Reward has already been claimed for this challenge"
}
```

---

### 3.3 Submit Challenge Screen Recording Proof
- **Method**: `POST`
- **Endpoint**: `/challenges/{id}/submit-proof`
- **Path Parameter**: `id` -> Challenge ID (e.g. `c1`)
- **Auth**: `Bearer <token>`
- **Content-Type**: `multipart/form-data`
- **Form Data Fields**:
  - `file`: `[Binary MP4 video file]` (Match recording proof, up to 60MB)
  - `challenge_id`: `"c1"` (string, optional)
  - `resolution`: `"480p"` (string, optional)
- **Response `200 OK`**:
```json
{
  "status": "success",
  "message": "Proof uploaded successfully",
  "challenge_id": "c1",
  "proof_url": "https://blastx-esports-backend-production-4b5f.up.railway.app/uploads/proofs/c1_user123_1727373800000.mp4"
}
```

---

## 4. Live Tournaments & Teams Section APIs

### 4.1 Get Tournaments List
- **Method**: `GET`
- **Endpoint**: `/tournaments`
- **Query Parameters**:
  - `page` (int, default: `1`)
  - `limit` (int, default: `50`)
  - `status` (string, optional: `live`, `upcoming`, `completed`)
  - `game` (string, optional: `Free Fire`)
  - `team_mode` (string, optional: `SQUAD`, `DUO`, `SOLO`)
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": "tourney_123",
        "title": "Free Fire Max India Cup",
        "banner_url": "https://storage.blastx.com/banners/tourney_123.jpg",
        "format": "BATTLE_ROYALE",
        "team_mode": "SQUAD",
        "map": "Bermuda",
        "max_slots": 48,
        "registered_count": 32,
        "slots_left": 16,
        "entry_fee": 0,
        "prize_pool": 300000,
        "status": "LIVE",
        "starts_at": "2026-03-26T18:00:00.000Z"
      }
    ],
    "page": 1,
    "limit": 50,
    "total": 1
  }
}
```

---

### 4.2 Get Tournament Details
- **Method**: `GET`
- **Endpoint**: `/tournaments/{tournamentId}`
- **Auth**: Optional `Bearer <token>` (if present, identifies if caller is registered)
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": "tourney_123",
    "title": "Free Fire Max India Cup",
    "description": "Official Free Fire tournament",
    "format": "BATTLE_ROYALE",
    "team_mode": "SQUAD",
    "map": "Bermuda",
    "max_slots": 48,
    "registered_count": 32,
    "slots_left": 16,
    "entry_fee": 0,
    "prize_pool": 300000,
    "prize_distribution": [
      { "label": "1st Place", "amount": 150000 },
      { "label": "2nd Place", "amount": 80000 },
      { "label": "3rd Place", "amount": 40000 }
    ],
    "rules": [
      "No emulators allowed.",
      "Hacking or exploiting glitches leads to instant disqualification."
    ],
    "status": "REGISTRATION_OPEN",
    "is_registered": false
  }
}
```

---

### 4.3 Get Custom Room ID & Password
- **Method**: `GET`
- **Endpoint**: `/tournaments/{tournamentId}/room`
- **Auth**: `Bearer <token>` (Must be a registered participant)
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "room_id": "8934201",
    "room_password": "FFX7",
    "room_released_at": "2026-03-26T18:15:00.000Z"
  }
}
```
- **Error `403 Forbidden`**: If credentials are not released yet or caller is not registered.

---

### 4.4 Get Tournament Participants List
- **Method**: `GET`
- **Endpoint**: `/tournaments/{tournamentId}/participants`
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": [
    {
      "id": "reg_01",
      "slot_number": 1,
      "status": "CONFIRMED",
      "user": {
        "id": "usr_99",
        "name": "Aman Sharma"
      },
      "team": {
        "id": "team_789",
        "name": "BLX Warriors",
        "tag": "BLX"
      }
    }
  ]
}
```

---

### 4.5 Get Tournament Matches
- **Method**: `GET`
- **Endpoint**: `/tournaments/{tournamentId}/matches`
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": [
    {
      "id": "match_01",
      "match_number": 1,
      "map": "Bermuda",
      "status": "LIVE",
      "scheduled_at": "2026-03-26T18:30:00.000Z"
    }
  ]
}
```

---

### 4.6 Get Tournament Standings & Leaderboard
- **Method**: `GET`
- **Endpoint**: `/tournaments/{tournamentId}/leaderboard`
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": [
    {
      "rank": 1,
      "team_name": "Total Gaming Esports",
      "kills": 24,
      "placement_points": 30,
      "total_points": 54
    }
  ]
}
```

---

### 4.7 Get User's Team in Tournament
- **Method**: `GET`
- **Endpoint**: `/tournaments/{tournamentId}/my-team`
- **Auth**: `Bearer <token>`
- **Response `200 OK`** (If user has a team in this tournament):
```json
{
  "status": "success",
  "data": {
    "id": "team_789",
    "name": "BLX Warriors",
    "tag": "BLX",
    "invite_code": "BLX7K29",
    "captain_id": "usr_me",
    "members": [ ... ]
  }
}
```
*Note: Returns `null` in `data` if the user is not in a team for this tournament.*

---

### 4.8 Create Team (as Captain) for Tournament
- **Method**: `POST`
- **Endpoint**: `/tournaments/{tournamentId}/teams`
- **Auth**: `Bearer <token>`
- **Request Body**:
```json
{
  "name": "BLX Warriors",
  "tag": "BLX",
  "logo_url": "",
  "accepting_substitutes": true,
  "player": {
    "name": "Rahul Verma",
    "ign": "BLX_Rahul",
    "uid": "109823471"
  }
}
```
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": "team_789",
    "name": "BLX Warriors",
    "tag": "BLX",
    "invite_code": "BLX7K29",
    "captain_id": "usr_me",
    "accepting_substitutes": true,
    "members": [
      {
        "user_id": "usr_me",
        "role": "CAPTAIN"
      }
    ]
  }
}
```

---

### 4.9 Lookup Team by Invite Code
- **Method**: `GET`
- **Endpoint**: `/tournaments/{tournamentId}/teams/code/{code}`
- **Auth**: `Bearer <token>`
- **Path Parameters**:
  - `tournamentId`: Tournament ID
  - `code`: 6-8 character team invite code (e.g. `BLX7K29`)
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": "team_789",
    "name": "BLX Warriors",
    "tag": "BLX",
    "roster_info": {
      "main_players_count": 2,
      "max_main_players": 4,
      "substitute_count": 0,
      "max_substitutes": 1,
      "accepting_substitutes": true,
      "can_join_main": true,
      "can_join_substitute": true,
      "is_full": false
    },
    "members": [ ... ]
  }
}
```

---

### 4.10 Join Team
- **Method**: `POST`
- **Endpoint**: `/teams/{teamId}/join`
- **Auth**: `Bearer <token>`
- **Request Body**:
```json
{
  "invite_code": "BLX7K29",
  "as_substitute": false,
  "rosterType": "MAIN",
  "player": {
    "name": "Amit Kumar",
    "ign": "BLX_Amit",
    "uid": "887766554"
  }
}
```
- **Behavior**: If main roster is full (4/4) and team accepts substitutes, automatically joins as `SUBSTITUTE`.
- **Response `200 OK`**: Returns updated team object with the user added to `members`.

---

### 4.11 Leave Team
- **Method**: `POST`
- **Endpoint**: `/teams/{teamId}/leave`
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "message": "Successfully left the team"
  }
}
```

---

### 4.12 Remove Member (Captain Only)
- **Method**: `POST`
- **Endpoint**: `/teams/{teamId}/members/{userId}`
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "message": "Member removed from team"
  }
}
```

---

### 4.13 Transfer Captaincy
- **Method**: `POST`
- **Endpoint**: `/teams/{teamId}/transfer-captain`
- **Auth**: `Bearer <token>`
- **Request Body**:
```json
{
  "new_captain_id": "usr_456"
}
```
- **Response `200 OK`**: Returns team with updated `captain_id`.

---

### 4.14 Toggle Substitute Acceptance
- **Method**: `PATCH`
- **Endpoint**: `/teams/{teamId}/substitutes`
- **Auth**: `Bearer <token>`
- **Request Body**: Accepts either camelCase or snake_case:
```json
{
  "accepting_substitutes": true,
  "acceptingSubstitutes": true
}
```
- **Response `200 OK`**: Returns updated team object.

---

### 4.15 Complete Tournament Registration (Finalize Roster)
- **Method**: `POST`
- **Endpoint**: `/tournaments/{tournamentId}/register`
- **Auth**: `Bearer <token>`
- **Request Body**:
```json
{
  "team_id": "team_789"
}
```
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "id": "reg_123",
    "tournament_id": "tourney_123",
    "team_id": "team_789",
    "status": "CONFIRMED",
    "slot_number": 12
  }
}
```

---

### 4.16 Cancel Tournament Registration
- **Method**: `POST` (or `DELETE`)
- **Endpoint**: `/tournaments/{tournamentId}/register/delete` (or `DELETE /tournaments/{tournamentId}/register`)
- **Auth**: `Bearer <token>`
- **Response `200 OK`**:
```json
{
  "status": "success",
  "data": {
    "message": "Successfully unregistered from tournament"
  }
}
```
