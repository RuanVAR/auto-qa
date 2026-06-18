-- Multiple screen recordings per issue (up to 2 from the bug modal).
-- recordingUrl stays as the back-compat "first recording" mirror.
ALTER TABLE "issues" ADD COLUMN "recordingUrls" TEXT[] NOT NULL DEFAULT '{}';
