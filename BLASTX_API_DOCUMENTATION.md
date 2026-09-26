# BlastX Esports — Mobile App Developer API Reference Manual

> **Document Version**: `2.1.0`  
> **Target Client**: BlastX Esports Flutter Mobile App  
> **Last Updated**: September 2026  
> **Target Game**: Free Fire / Free Fire Max Exclusive  

---

## Table of Contents
1. [Global Configuration & Environments](#1-global-configuration--environments)
2. [Standard Response Envelope & Errors](#2-standard-response-envelope--errors)
3. [Section 1: Profile APIs](#3-section-1-profile-apis)
   - [1.1 Get Authenticated User Profile & Live Stats (GET /users/me)](#11-get-authenticated-user-profile--live-stats)
   - [1.2 Update User Profile (PATCH /users/me)](#12-update-user-profile)
   - [1.3 Get User Game Profile (GET /users/me/game-profile)](#13-get-user-game-profile)
   - [1.4 Upsert Game Profile (POST /users/me/game-profile)](#14-upsert-game-profile)
   - [1.5 Get Registered Tournaments Sync (GET /tournaments/me)](#15-get-registered-tournaments-sync)
4. [Section 2: Challenges APIs](#4-section-2-challenges-apis)
   - [2.1 Get All Challenges & Progress (GET /challenges)](#21-get-all-challenges--progress)
   - [2.2 Claim Challenge Reward (POST /challenges/{id}/claim)](#22-claim-challenge-reward)
   - [2.3 Submit Match Video Proof (POST /challenges/{id}/submit-proof)](#23-submit-match-video-proof)
5. [Section 3: Live Tournaments & Squad APIs](#5-section-3-live-tournaments--squad-apis)
   - [3.1 Get Tournaments List (GET /tournaments)](#31-get-tournaments-list)
   - [3.2 Get Tournament Details (GET /tournaments/{id})](#32-get-tournament-details)
   - [3.3 Get Custom Room ID & Password (GET /tournaments/{id}/room)](#33-get-custom-room-id--password)
   - [3.4 Get Tournament Participants (GET /tournaments/{id}/participants)](#34-get-tournament-participants)
   - [3.5 Get Tournament Matches (GET /tournaments/{id}/matches)](#35-get-tournament-matches)
   - [3.6 Get Tournament Leaderboard (GET /tournaments/{id}/leaderboard)](#36-get-tournament-leaderboard)
   - [3.7 Get User Squad in Tournament (GET /tournaments/{id}/my-team)](#37-get-user-squad-in-tournament)
   - [3.8 Create Squad as Captain (POST /tournaments/{id}/teams)](#38-create-squad-as-captain)
   - [3.9 Lookup Squad by Invite Code (GET /tournaments/{id}/teams/code/{code})](#39-lookup-squad-by-invite-code)
   - [3.10 Join Squad (POST /teams/{teamId}/join)](#310-join-squad)
   - [3.11 Leave Squad (POST /teams/{teamId}/leave)](#311-leave-squad)
   - [3.12 Remove Member (POST /teams/{teamId}/members/{userId})](#312-remove-member)
   - [3.13 Transfer Captaincy (POST /teams/{teamId}/transfer-captain)](#313-transfer-captaincy)
   - [3.14 Toggle Substitute Acceptance (PATCH /teams/{teamId}/substitutes)](#314-toggle-substitute-acceptance)
   - [3.15 Finalize Tournament Registration (POST /tournaments/{id}/register)](#315-finalize-tournament-registration)
   - [3.16 Cancel Tournament Registration (POST /tournaments/{id}/register/delete)](#316-cancel-tournament-registration)
6. [Complete API Summary Matrix](#6-complete-api-summary-matrix)

---

## 1. Global Configuration & Environments

### Base URLs
- **Production Server**:  
  `https://blastx-esports-backend-production-4b5f.up.railway.app/v1`
- **Local Dev Server**:  
  `http://localhost:3000/v1`

### Default Request Headers
```http
Content-Type: application/json
Accept: application/json
Authorization: Bearer <USER_JWT_TOKEN>
```

---

## 2. Standard Response Envelope & Errors

All successful API responses return HTTP 200/201 wrapped in the standard envelope:

```json
{
  "status": "success",
  "data": { ... }
}
```

### Error Response Format
```json
{
  "status": "error",
  "message": "Specific error explanation",
  "error": "Bad Request",
  "statusCode": 400
}
```

### Common HTTP Status Codes
| Code | Meaning | Action for App |
| :--- | :--- | :--- |
| `200` | OK | Parse response payload from `data`. |
| `201` | Created | Resource successfully created. |
| `400` | Bad Request | Form/validation error or business rule failed. Display `message`. |
| `401` | Unauthorized | Token expired/missing. Clear storage and route to Login. |
| `403` | Forbidden | Insufficient permissions or time-gated (e.g. room password before match). |
| `404` | Not Found | Resource not found or user has no squad in this tournament. |
| `500` | Internal Error | Server-side fault. Show retry toast. |

---

## 3. Section 1: Profile APIs

### 1.1 Get Authenticated User Profile & Live Stats
- **Method**: `GET`
- **Endpoint**: `/users/me`
- **Auth**: `Bearer <token>`
- **Description**: Returns basic user identity alongside live calculated statistics (`tournaments_played`, `tournaments_won`, `total_kills`, `win_rate`, `xp`, `rank`) and embedded primary Free Fire in-game profile.

#### Response `200 OK`
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

### 1.2 Update User Profile
- **Method**: `PATCH`
- **Endpoint**: `/users/me`
- **Auth**: `Bearer <token>`
- **Description**: Updates profile name and/or avatar URL.

#### Request Body
```json
{
  "name": "Alex 'Sniper' Mercer",
  "profile_pic": "https://storage.blastx.com/profiles/new_pic.jpg"
}
```

#### Response `200 OK`
Returns the updated user object with refreshed statistics.

---

### 1.3 Get User Game Profile
- **Method**: `GET`
- **Endpoint**: `/users/me/game-profile?game_slug=free_fire`
- **Auth**: `Bearer <token>`
- **Query Parameters**:
  - `game_slug` (string, optional, default: `"free_fire"`)

#### Response `200 OK`
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

### 1.4 Upsert Game Profile
- **Method**: `POST` (or `PUT`)
- **Endpoint**: `/users/me/game-profile`
- **Auth**: `Bearer <token>`
- **Description**: Links or updates the user's In-Game ID (Player ID) and In-Game Name (IGN) for Free Fire.

#### Request Body
```json
{
  "game_slug": "free_fire",
  "in_game_uid": "512839401",
  "in_game_name": "ProGamer_X"
}
```

#### Response `200 OK`
Returns the saved `GameProfile` object.

---

### 1.5 Get Registered Tournaments Sync
- **Method**: `GET`
- **Endpoint**: `/tournaments/me`
- **Auth**: `Bearer <token>`
- **Description**: Returns all tournaments registered by the caller for real-time count synchronization on the profile dashboard.

#### Response `200 OK`
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

## 4. Section 2: Challenges APIs

### 2.1 Get All Challenges & Progress
- **Method**: `GET`
- **Endpoint**: `/challenges`
- **Auth**: `Bearer <token>`
- **Description**: Returns active challenges (Daily, Weekly, Special) merged with the caller's live progress.

#### Response `200 OK`
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

### 2.2 Claim Challenge Reward
- **Method**: `POST`
- **Endpoint**: `/challenges/{id}/claim`
- **Auth**: `Bearer <token>`
- **Path Parameter**: `{id}` -> Challenge ID (e.g., `c1`, `c2`)
- **Description**: Credits the `reward_xp` to the player's account and updates the status to `CLAIMED`. Prevents double-claiming.

#### Response `200 OK`
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

---

### 2.3 Submit Match Video Proof
- **Method**: `POST`
- **Endpoint**: `/challenges/{id}/submit-proof`
- **Auth**: `Bearer <token>`
- **Content-Type**: `multipart/form-data`
- **Form Data Fields**:
  - `file`: `[Binary .mp4 video file]` (Match recording proof, up to 60MB)
  - `challenge_id`: `"c1"` (string, optional)
  - `resolution`: `"480p"` (string, optional)

#### Response `200 OK`
```json
{
  "status": "success",
  "message": "Proof uploaded successfully",
  "challenge_id": "c1",
  "proof_url": "https://blastx-esports-backend-production-4b5f.up.railway.app/uploads/proofs/c1_user123_1727373800000.mp4"
}
```

---

## 5. Section 3: Live Tournaments & Squad APIs

### 3.1 Get Tournaments List
- **Method**: `GET`
- **Endpoint**: `/tournaments`
- **Query Parameters**:
  - `page` (int, default: `1`)
  - `limit` (int, default: `50`)
  - `status` (string, optional: `live`, `upcoming`, `completed`)
  - `game` (string, optional: `Free Fire`)
  - `team_mode` (string, optional: `SQUAD`, `DUO`, `SOLO`)
  - `map` (string, optional: `Bermuda`, `Purgatory`, `Kalahari`)

#### Response `200 OK`
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

### 3.2 Get Tournament Details
- **Method**: `GET`
- **Endpoint**: `/tournaments/{id}`
- **Auth**: Optional `Bearer <token>` (detects if user is registered)

#### Response `200 OK`
```json
{
  "status": "success",
  "data": {
    "id": "tourney_123",
    "title": "Free Fire Max India Cup",
    "description": "Official Free Fire Tournament",
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

### 3.3 Get Custom Room ID & Password
- **Method**: `GET`
- **Endpoint**: `/tournaments/{id}/room`
- **Auth**: `Bearer <token>` (Must be a registered participant)

#### Response `200 OK`
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
*Note: Returns `403 Forbidden` if credentials have not been released yet.*

---

### 3.4 Get Tournament Participants
- **Method**: `GET`
- **Endpoint**: `/tournaments/{id}/participants`

#### Response `200 OK`
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

### 3.5 Get Tournament Matches
- **Method**: `GET`
- **Endpoint**: `/tournaments/{id}/matches`

#### Response `200 OK`
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

### 3.6 Get Tournament Leaderboard
- **Method**: `GET`
- **Endpoint**: `/tournaments/{id}/leaderboard`

#### Response `200 OK`
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

### 3.7 Get User Squad in Tournament
- **Method**: `GET`
- **Endpoint**: `/tournaments/{id}/my-team`
- **Auth**: `Bearer <token>`
- **Description**: Checks if user is in a squad for this tournament. Returns `null` if not in any squad.

#### Response `200 OK`
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
    "members": [ ... ]
  }
}
```

---

### 3.8 Create Squad as Captain
- **Method**: `POST`
- **Endpoint**: `/tournaments/{id}/teams`
- **Auth**: `Bearer <token>`

#### Request Body
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

#### Response `200 OK`
```json
{
  "status": "success",
  "data": {
    "id": "team_789",
    "name": "BLX Warriors",
    "tag": "BLX",
    "invite_code": "BLX7K29",
    "captain_id": "usr_me",
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

### 3.9 Lookup Squad by Invite Code
- **Method**: `GET`
- **Endpoint**: `/tournaments/{id}/teams/code/{code}`
- **Auth**: `Bearer <token>`
- **Path Parameters**:
  - `id`: Tournament ID
  - `code`: 6-8 character team invite code (e.g. `BLX7K29`)

#### Response `200 OK`
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

### 3.10 Join Squad
- **Method**: `POST`
- **Endpoint**: `/teams/{teamId}/join`
- **Auth**: `Bearer <token>`
- **Behavior**: If main slots are full (4/4) and substitute acceptance is enabled, joins as `SUBSTITUTE`.

#### Request Body
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

#### Response `200 OK`
Returns updated squad with player added to `members`.

---

### 3.11 Leave Squad
- **Method**: `POST`
- **Endpoint**: `/teams/{teamId}/leave`
- **Auth**: `Bearer <token>`

#### Response `200 OK`
```json
{
  "status": "success",
  "data": {
    "message": "Successfully left the team"
  }
}
```

---

### 3.12 Remove Member (Captain Only)
- **Method**: `POST`
- **Endpoint**: `/teams/{teamId}/members/{userId}`
- **Auth**: `Bearer <token>`

#### Response `200 OK`
```json
{
  "status": "success",
  "data": {
    "message": "Member removed from team"
  }
}
```

---

### 3.13 Transfer Captaincy
- **Method**: `POST`
- **Endpoint**: `/teams/{teamId}/transfer-captain`
- **Auth**: `Bearer <token>`

#### Request Body
```json
{
  "new_captain_id": "usr_456"
}
```

#### Response `200 OK`
Returns squad object with updated `captain_id`.

---

### 3.14 Toggle Substitute Acceptance
- **Method**: `PATCH`
- **Endpoint**: `/teams/{teamId}/substitutes`
- **Auth**: `Bearer <token>`

#### Request Body (Accepts both formats)
```json
{
  "accepting_substitutes": true,
  "acceptingSubstitutes": true
}
```

#### Response `200 OK`
Returns updated team object.

---

### 3.15 Finalize Tournament Registration
- **Method**: `POST`
- **Endpoint**: `/tournaments/{id}/register`
- **Auth**: `Bearer <token>`

#### Request Body
```json
{
  "team_id": "team_789"
}
```

#### Response `200 OK`
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

### 3.16 Cancel Tournament Registration
- **Method**: `POST` (or `DELETE`)
- **Endpoint**: `/tournaments/{id}/register/delete` (or `DELETE /tournaments/{id}/register`)
- **Auth**: `Bearer <token>`

#### Response `200 OK`
```json
{
  "status": "success",
  "data": {
    "message": "Successfully unregistered from tournament"
  }
}
```

---

## 6. Complete API Summary Matrix

| # | HTTP Method | Endpoint Path | Function / Screen |
| :---: | :---: | :--- | :--- |
| **1** | `GET` | `/v1/users/me` | Fetch Profile & Live Esports Statistics |
| **2** | `PATCH` | `/v1/users/me` | Update Profile Name & Avatar Image |
| **3** | `GET` | `/v1/users/me/game-profile` | Fetch Saved Free Fire IGN & UID |
| **4** | `POST` | `/v1/users/me/game-profile` | Link/Save Free Fire IGN & UID |
| **5** | `GET` | `/v1/tournaments/me` | User's Registered Tournaments (Count Sync) |
| **6** | `GET` | `/v1/challenges` | List Active & Available Challenges with Progress |
| **7** | `POST` | `/v1/challenges/{id}/claim` | Claim Completed Challenge XP Reward |
| **8** | `POST` | `/v1/challenges/{id}/submit-proof` | Upload 480p Match Screen Recording Video |
| **9** | `GET` | `/v1/tournaments` | Fetch Live & Upcoming Free Fire Tournaments |
| **10** | `GET` | `/v1/tournaments/{id}` | Fetch Tournament Details, Rules & Prize Pool |
| **11** | `GET` | `/v1/tournaments/{id}/room` | Fetch Custom Room ID & Password (Gated) |
| **12** | `GET` | `/v1/tournaments/{id}/participants` | Fetch Registered Players & Squads |
| **13** | `GET` | `/v1/tournaments/{id}/matches` | Fetch Tournament Matches & Status |
| **14** | `GET` | `/v1/tournaments/{id}/leaderboard` | Fetch Standings, Placement & Kill Points |
| **15** | `GET` | `/v1/tournaments/{id}/my-team` | Check Current User Squad Status in Tournament |
| **16** | `POST` | `/v1/tournaments/{id}/teams` | Create New Squad as Captain |
| **17** | `GET` | `/v1/tournaments/{id}/teams/code/{code}` | Lookup Squad by Invite Code |
| **18** | `POST` | `/v1/teams/{teamId}/join` | Join Squad (Main or Substitute) |
| **19** | `POST` | `/v1/teams/{teamId}/leave` | Leave Squad Roster |
| **20** | `POST` | `/v1/teams/{teamId}/members/{userId}` | Kick Squad Member (Captain Only) |
| **21** | `POST` | `/v1/teams/{teamId}/transfer-captain` | Transfer Captain Role to another Member |
| **22** | `PATCH` | `/v1/teams/{teamId}/substitutes` | Toggle Substitute Acceptance |
| **23** | `POST` | `/v1/tournaments/{id}/register` | Finalize Tournament Registration (Lock Squad) |
| **24** | `POST` | `/v1/tournaments/{id}/register/delete` | Cancel Tournament Registration |
