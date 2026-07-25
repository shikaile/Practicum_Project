import sqlite3
import pandas as pd
import re
import os

# ---------- CONFIG ----------
DB_PATH = "/Users/malikyehia/Downloads/Practicum Dashboard/Dashboard Connection"
CSV_PATH = "/Users/malikyehia/Downloads/2026-0-21 Melvindale vs Romulus stats.csv"
MY_TEAM_NAME = "Melvindale"
# -----------------------------

# ---------- Parse the filename for date + matchup (same pattern as team stats) ----------
filename = os.path.basename(CSV_PATH)
match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})[ _](.+?)[ _]vs[ _](.+?)[ _]", filename)
year, month_zero_indexed, day, team_a, team_b = match.groups()

game_month = int(month_zero_indexed) + 1
game_date = f"{year}-{game_month:02d}-{int(day):02d}"

opponent = team_b if team_a == MY_TEAM_NAME else team_a
print(f"Parsed from filename -> Date: {game_date}, Opponent: {opponent}")

# ---------- Connect to the real database ----------
conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = ON;")
cursor = conn.cursor()

# ---------- Look up the existing GameID (inserted earlier by the team stats script) ----------
cursor.execute(
    "SELECT GameID FROM Game WHERE GameDate = ? AND Opponent = ?",
    (game_date, opponent)
)
result = cursor.fetchone()
if result is None:
    raise ValueError(
        f"No matching Game found for date {game_date} vs {opponent}. "
        "Make sure the team box score for this game has already been ingested first."
    )
game_id = result[0]
print(f"Found existing GameID: {game_id}")

# ---------- Read the CSV ----------
df = pd.read_csv(CSV_PATH)

# The home/away "Team" column is unreliable. Instead, filter out opponent rows by
# checking whether the Athlete name is prefixed with the opponent's name
# (mp-advantage auto-generates opponent placeholder names as "{OpponentName}_# Player").
my_players_df = df[~df["Athlete"].str.startswith(f"{opponent}_")].copy()
print(f"Filtered {len(df)} total rows down to {len(my_players_df)} rows for {MY_TEAM_NAME}.")

# ---------- Helper: convert "MM:SS" into total seconds ----------
def mp_to_seconds(mp_str):
    minutes, seconds = str(mp_str).split(":")
    return int(minutes) * 60 + int(seconds)

# ---------- Helper: clean the +/- column (strips a leading apostrophe if present) ----------
def clean_plus_minus(value):
    return int(str(value).lstrip("'"))

# ---------- Map CSV columns to PlayerStats columns ----------
column_map = {
    "Basic:PTS": "Points",
    "Basic:FGM": "FGM",
    "Basic:FGA": "FGA",
    "Basic:FG%": "FG%",
    "Basic:3FGM": "3FGM",
    "Basic:3FGA": "3FGA",
    "Basic:3FG%": "3FG%",
    "Basic:FTM": "FTMade",
    "Basic:FTA": "FTAttempt",
    "Basic:FT%": "FT%",
    "Basic:ORB": "OffensiveRebound",
    "Basic:DRB": "DefensiveRebound",
    "Basic:TRB": "Rebounds",
    "Basic:AST": "Assists",
    "Basic:STL": "Steals",
    "Basic:BLK": "Blocks",
    "Basic:TO": "Turnovers",
    "Basic:PF": "PF",
    "Advanced:ORB%": "OREB%",
    "Advanced:DRB%": "DREB%",
    "Advanced:TRB%": "TREB%",
    "Advanced:AST%": "AST%",
    "Advanced:AST/TO": "AST_TO_RATIO",
    "Advanced:TO-Ratio": "TO_Ratio",
    "Advanced:USG%": "USG%",
    "Advanced:Ch.-Drawn": "ChargeDrawn",
    "Shooting:TS%": "TS%",
    "Shooting:eFG%": "eFG%",
}

# ---------- Process each player row ----------
inserted_count = 0
for _, row in my_players_df.iterrows():
    player_name = row["Athlete"]
    player_number = int(row["#"])

    # --- Look up or create this player ---
    cursor.execute("SELECT PlayerID FROM Player WHERE Player_Number = ?", (player_number,))
    existing = cursor.fetchone()
    if existing:
        player_id = existing[0]
    else:
        cursor.execute(
            "INSERT INTO Player (PlayerName, Player_Number) VALUES (?, ?)",
            (player_name, player_number)
        )
        player_id = cursor.lastrowid
        print(f"  Created new player: {player_name} (#{player_number}) -> PlayerID {player_id}")

    # --- Build the row to insert into PlayerStats ---
    stat_values = {"PlayerID": player_id, "GameID": game_id}
    stat_values["MP"] = mp_to_seconds(row["Basic:MP"])
    stat_values["PlusMinus"] = clean_plus_minus(row["Advanced:+/-"])
    for csv_col, table_col in column_map.items():
        stat_values[table_col] = row[csv_col]

    col_names = ", ".join(f'"{c}"' for c in stat_values.keys())
    placeholders = ", ".join(["?"] * len(stat_values))
    cursor.execute(
        f'INSERT INTO PlayerStats ({col_names}) VALUES ({placeholders})',
        list(stat_values.values())
    )
    inserted_count += 1

conn.commit()
print(f"\nInserted {inserted_count} PlayerStats rows for GameID {game_id}.")

# ---------- Verify ----------
cursor.execute("SELECT PlayerID, PlayerName, Player_Number FROM Player")
print("\nPlayer table:", cursor.fetchall())

cursor.execute(
    "SELECT PlayerID, GameID, MP, Points, Assists, Steals, Blocks, Turnovers, PlusMinus FROM PlayerStats WHERE GameID = ?",
    (game_id,)
)
print("PlayerStats rows:", cursor.fetchall())

conn.close()