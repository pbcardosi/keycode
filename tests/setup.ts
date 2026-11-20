// Ink suppresses dynamic output when CI is set. The TUI tests render into a
// PassThrough stream and need normal render output, so hide CI from Ink while
// keeping the surrounding environment intact for everything else.
delete process.env.CI;
delete process.env.CONTINUOUS_INTEGRATION;
