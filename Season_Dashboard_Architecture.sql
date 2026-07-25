
CREATE TABLE Player(
    PlayerID INTEGER PRIMARY KEY,
    PlayerName nvarchar(60),
    Player_Number INT,
    Class nvarchar(5)
);

]
CREATE TABLE PlayerStats(
    PlayerStatsID INTEGER PRIMARY KEY,
    PlayerID INTEGER NOT NULL,
    GameID INTEGER NOT NULL,
    MP INT,
    Points INT,
    FGM INT,
    FGA INT,
    "FG%" REAL,
    "3FGM" INTEGER,
    "3FGA" INTEGER,
    "3FG%" REAL,
    FTMade INTEGER,
    FTAttempt INTEGER,
    "FT%" REAL,
    OffensiveRebound INTEGER,
    DefensiveRebound INTEGER,
    Rebounds INTEGER,
    PF INT,
    PlusMinus INT,
    "OREB%" REAL,
    "DREB%" REAL,
    "TREB%" REAL,
    "AST%" REAL,
    AST_TO_RATIO REAL,
    TO_Ratio REAL,
    "USG%" REAL,
    ChargeDrawn INT,
    "TS%" REAL,
    "eFG%" REAL,
    FOREIGN KEY (PlayerID) REFERENCES Player(PlayerID),
    FOREIGN KEY (GameID) REFERENCES Game(GameID)
);

CREATE TABLE Game(
    GameID INTEGER PRIMARY KEY,
    GameDate DATE,
    Opponent nvarchar(40),
    Location nvarchar(10)
);


CREATE TABLE GameStats (
    GameStatsID INTEGER PRIMARY KEY,
    GameID INTEGER NOT NULL,
    TeamRole TEXT NOT NULL CHECK (TeamRole IN ('Team', 'Opponent')),
 
    Points INTEGER NOT NULL,
    Q1Points INTEGER,
    Q2Points INTEGER,
    Q3Points INTEGER,
    Q4Points INTEGER,
    OTPoints INTEGER,
    FGMade INTEGER,
    FGAttempts INTEGER,
    "FG%" REAL,
    "3FGM" INTEGER,
    "3FGA" INTEGER,
    "3FG%" REAL,
    FTMade INTEGER,
    FTAttempt INTEGER,
    "FT%" REAL,
    OffensiveRebound INTEGER,
    DefensiveRebound INTEGER,
    Rebounds INTEGER,
    Assists INTEGER,
    Steals INTEGER,
    Blocks INTEGER,
    Turnovers INTEGER,
    Fouls INTEGER,
    "TS%" REAL,
    "EFG%" REAL,
    "OREB%" REAL,
    "DREB%" REAL,
    AST_TO_RATIO REAL,
    "TO%" REAL,
    OFFRating REAL,
    DEFRating REAL,
 
    FOREIGN KEY (GameID) REFERENCES Game(GameID),
    UNIQUE (GameID, TeamRole)
)



    
    
    DELETE FROM GameStats;
	DELETE FROM Game;

    SELECT * FROM GameStats;
    SELECT * FROM Game;
    
    
    SELECT * FROM PlayerStats
    
    SELECT * FROM PLAYER
    
    
    
ALTER TABLE PlayerStats ADD COLUMN Assists INTEGER;
ALTER TABLE PlayerStats ADD COLUMN Steals INTEGER;
ALTER TABLE PlayerStats ADD COLUMN Blocks INTEGER;
ALTER TABLE PlayerStats ADD COLUMN Turnovers INTEGER;
    
   