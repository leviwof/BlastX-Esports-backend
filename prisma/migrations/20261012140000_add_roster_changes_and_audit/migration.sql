-- CreateEnum
CREATE TYPE "RegistrationSubmissionKind" AS ENUM ('REGISTRATION', 'ROSTER_CHANGE');

-- AlterEnum
ALTER TYPE "RegistrationSubmissionStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN "roster_lock_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "registration_submissions" ADD COLUMN "remove_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "kind" "RegistrationSubmissionKind" NOT NULL DEFAULT 'REGISTRATION',
ADD COLUMN "cancelled_at" TIMESTAMP(3);
