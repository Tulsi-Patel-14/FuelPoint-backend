-- AlterEnum
ALTER TYPE "AccountStatus" ADD VALUE 'OFFLINE';

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;
