# Code Block 1 (Slide 2: The Hardcode Trap)
```python
# Hardcoded name everywhere...
# ...and imagine 50 more lines like this.
print("Welcome, Shadow_Blade!")
print("Shadow_Blade leveled up!")
print("Shadow_Blade defeated the boss!")
print("Shadow_Blade's score: 1000")
```

---

# Code Block 2 (Slide 3: The "Missed One" Bug)
```python
# Rename time! Shadow_Blade -> Dragon_Slayer
print("Welcome, Dragon_Slayer!")
print("Shadow_Blade leveled up!")  # <-- OOPS. Missed one.
print("Dragon_Slayer defeated the boss!")
print("Dragon_Slayer's score: 1000")
```

---

# Code Block 3 (Slide 4: The Variable Fix (Show payoff))
```python
character_name = "Shadow_Blade"

print("Welcome,", character_name)
print(character_name, "leveled up!")
print(character_name, "defeated the boss!")
print(character_name, "'s score:", 1000)
```

---

# Code Block 4 (Slide 5: Change It Once)
```python
character_name = "Dragon_Slayer"  # One change

print("Welcome,", character_name)
print(character_name, "leveled up!")
print(character_name, "defeated the boss!")
```

---

# Code Block 5 (Slide 7: Creating Your First Variable)
```python
favorite_snack = "Kale Chips"
```

---

# Code Block 6 (Slide 8: Variables Hold Different Types (Backpack Pockets))
```python
game_title = "CodeStrike"
max_players = 100
player_level = 5
```

---

# Code Block 7 (Slide 9: The Assignment Symbol)
```python
level = 5
```

---

# Code Block 8 (Slide 10: Variables vs Direct Values)
```python
# Direct value (one-time):
print("Visit my channel!")  # shows once, then it's gone

# Variable (stored and reused):
channel_message = "Visit my channel!"
print(channel_message)
print(channel_message)
print(channel_message)
```

---

# Code Block 9 (Slide 11: Key Takeaway)
```python
variable_name = value
# Name = what you call it
# Value = what it remembers
```

---
