-- Migration 0002: add bech32_prefix to launches
ALTER TABLE launches ADD COLUMN bech32_prefix TEXT NOT NULL DEFAULT '';