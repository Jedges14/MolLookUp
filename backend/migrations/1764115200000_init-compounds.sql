-- Up Migration
CREATE TABLE compounds (
  cid              INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  iupac_name       TEXT,
  formula          TEXT,
  mol_weight       NUMERIC,
  canonical_smiles TEXT,
  inchikey         TEXT,
  xlogp            NUMERIC,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE compound_synonyms (
  cid     INTEGER NOT NULL REFERENCES compounds (cid) ON DELETE CASCADE,
  synonym TEXT NOT NULL,
  PRIMARY KEY (cid, synonym)
);

CREATE INDEX compound_synonyms_lower_synonym_idx ON compound_synonyms (lower(synonym));
CREATE INDEX compounds_lower_name_idx ON compounds (lower(name));

-- Down Migration
DROP TABLE compound_synonyms;
DROP TABLE compounds;
