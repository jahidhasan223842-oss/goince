-- Reviews moderation: status column (pending / approved / hidden).
-- Purono review gulo 'approved' thakbe, tai site-e jemon chilo temon-i dekhabe.
-- Notun review 'pending' hoye jabe, admin approve korle tobei dekhabe.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';
