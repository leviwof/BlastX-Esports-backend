-- CreateEnum
CREATE TYPE "OwnerRole" AS ENUM ('LEADER', 'MANAGER');

-- AlterEnum
ALTER TYPE "SquadRole" ADD VALUE 'MANAGER';

-- AlterEnum
ALTER TYPE "TeamMemberRole" ADD VALUE 'MANAGER';

-- AlterTable
ALTER TABLE "squads" ADD COLUMN "owner_role" "OwnerRole" NOT NULL DEFAULT 'LEADER';

-- AlterTable
ALTER TABLE "teams" ADD COLUMN "owner_role" "OwnerRole" NOT NULL DEFAULT 'LEADER';
