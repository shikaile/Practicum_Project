import sqlite3
import pandas as pd
import re
import os

# ---------- CONFIG ----------
DB_PATH = "/Users/malikyehia/Downloads/Practicum Dashboard/Dashboard Connection"
CSV_PATH = "/Users/malikyehia/Downloads/2025-11-12 Cesar Chavez vs Melvindale -team-box-score.csv"
MY_TEAM_NAME = "Melvindale"
# -----------------------------

# ---------- Parse the filename for date + matchup ----------
filename = os.path.basename(CSV_PATH)

# Matches: YYYY-M-D_TeamA_vs_TeamB (month is zero-indexed: 0=Jan, 11=Dec)
match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})[ _](.+?)[ _]vs[ _](.+?)[ _]", filename)
year, month_zero_indexed, day, away_team, home_team = match.groups()

game_month = int(month_zero_indexed) + 1  # convert 0-indexed month to real month
game_date = f"{year}-{game_month:02d}-{int(day):02d}"  # e.g. "2026-01-21"

# Determine Location and Opponent based on where MY_TEAM_NAME falls in the matchup
if away_team == MY_TEAM_NAME:
    location = "Away"
    opponent = home_team
elif home_team == MY_TEAM_NAME:
    location = "Home"
    opponent = away_team
else:
    raise ValueError(f"MY_TEAM_NAME '{MY_TEAM_NAME}' not found in filename matchup: {away_team} vs {home_team}")

print(f"Parsed from filename -> Date: {game_date}, Location: {location}, Opponent: {opponent}")

# ---------- Read and clean the CSV (same as before) ----------
df = pd.read_csv(CSV_PATH)

column_map = {
    "Points": "Points", 
    "1": "Q1Points", 
    "2": "Q2Points", 
    "3": "Q3Points", 
    "4": "Q4Points",
    "OT": "OTPoints", 
    "FG Made": "FGMade", 
    "FG Attempts": "FGAttempts", 
    "FG%": "FG%",
    "3FG Made": "3FGM", 
    "3FG Att": "3FGA", 
    "3FG%": "3FG%",
    "FT Made": "FTMade", 
    "FT Att": "FTAttempt", 
    "FT%": "FT%",
    "Offensive Rebounds": "OffensiveRebound", 
    "Defensive Rebounds": "DefensiveRebound", 
    "Rebounds": "Rebounds",
    "Assists": "Assists", 
    "Steals": "Steals", 
    "Blocks": "Blocks", 
    "Turnovers": "Turnovers", 
    "Fouls": "Fouls",
    "True Shooting%": "TS%", 
    "Effective Field Goal%": "EFG%",
    "Offensive Rebounding%": "OREB%", 
    "Defensive Rebounding%": "DREB%",
    "AST-TO Ratio": "AST_TO_RATIO", 
    "Turnover%": "TO%",
    "Off Rating": "OFFRating", 
    "Def Rating": "DEFRating",
}

rows = []
for _, row in df.iterrows():
    clean_row = {"Team": row["Team"]}
    for csv_col, table_col in column_map.items():
        clean_row[table_col] = row[csv_col]
    rows.append(clean_row)

clean_df = pd.DataFrame(rows)
clean_df["TeamRole"] = clean_df["Team"].apply(lambda t: "Team" if t == MY_TEAM_NAME else "Opponent")

# ---------- Connect to the real database ----------
conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = ON;")
cursor = conn.cursor()

# ---------- Insert the Game row, capture the new GameID ----------
cursor.execute(
    "INSERT INTO Game (GameDate, Opponent, Location) VALUES (?, ?, ?)",
    (game_date, opponent, location)
)
game_id = cursor.lastrowid
print(f"Inserted Game row with GameID: {game_id}")

# ---------- Insert both GameStats rows using that GameID ----------
gamestats_columns = [c for c in clean_df.columns if c != "Team"]  # drop Team, keep everything else

for _, row in clean_df.iterrows():
    values = [game_id] + [row[c] for c in gamestats_columns]
    placeholders = ", ".join(["?"] * len(values))
    # Wrap every column name in double quotes so names containing special
    # characters (like "FG%") are treated as identifiers, not broken syntax.
    col_names = ", ".join(f'"{c}"' for c in (["GameID"] + gamestats_columns))
    cursor.execute(
        f'INSERT INTO GameStats ({col_names}) VALUES ({placeholders})',
        values
    )

conn.commit()
print(f"Inserted {len(clean_df)} GameStats rows for GameID {game_id}.")

# ---------- Verify ----------
cursor.execute("SELECT * FROM Game WHERE GameID = ?", (game_id,))
print("\nGame row:", cursor.fetchone())

cursor.execute("SELECT GameID, TeamRole, Points FROM GameStats WHERE GameID = ?", (game_id,))

print("GameStats rows:", cursor.fetchall())

conn.close()