<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Arc 2: Memory \& Storage — STATIC VISUAL VERSION (v2.0)[1]

_All visuals below are specified for **single static images** per slide, with simple, uncluttered compositions suitable for NotebookLM-style generation. No video or slide numbers appear inside the visuals themselves._[^1]

***

## Video 6: Storing Data in Memory

**Duration:** ~150–160 seconds
**Concept:** Variables are named storage containers[^1]

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Video 6: Storing Data in Memory
```

**Supporting Visuals (Static):**

- Central icon of a simple computer chip or brain with small labeled drawers: "score", "username", "level".[^1]
- Subtitle under title: "Python's little memory system".
- Clean dark or gradient background.

**Audio:**
"You're building a game and need to remember the player's username, score, and level. Print them once? They're gone. You need to store data so you can use it throughout your code. That's what variables do—Python's little memory system."[^1]

***

### [SLIDE 2: The Hardcode Trap]

**Visual Main:**

```python
# Hardcoded name everywhere...
# ...and imagine 50 more lines like this.
print("Welcome, Shadow_Blade!")
print("Shadow_Blade leveled up!")
print("Shadow_Blade defeated the boss!")
print("Shadow_Blade's score: 1000")
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Code editor pane showing exactly this snippet.[^1]
- Multiple occurrences of `"Shadow_Blade"` highlighted to show repetition.
- Small caption: "Change name? Hunt through every line."

**Audio:**
"Imagine you hardcode your character's name everywhere in your game: welcome messages, level-up notifications, boss defeats—and imagine 50 more lines like this. This works… until you change your mind. And you will. Because naming a character is a sacred ritual: you pick something cool, then immediately regret it. Without variables, you have to hunt down every single mention and change it manually. Miss even one line and your game becomes inconsistent."[^1]

***

### [SLIDE 3: The “Missed One” Bug]

**Visual Main:**

```python
# Rename time! Shadow_Blade -> Dragon_Slayer
print("Welcome, Dragon_Slayer!")
print("Shadow_Blade leveled up!")  # <-- OOPS. Missed one.
print("Dragon_Slayer defeated the boss!")
print("Dragon_Slayer's score: 1000")
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Editor view with `"Shadow_Blade leveled up!"` highlighted and a small "OOPS" label.[^1]
- Speech bubble near code: "Identity crisis…"
- No extra text beyond short labels.

**Audio:**
"This is the classic bug: you update most lines, miss one, and now your game has identity issues. It's not broken in a dramatic way—it's broken in an embarrassing way."[^1]

***

### [SLIDE 4: The Variable Fix (Solution \& Power)]

**Visual Main:**

```python
# Before (Hardcoded chaos):
print("Welcome, Shadow_Blade!")
print("Shadow_Blade leveled up!")

# After (Variables rule):
character_name = "Dragon_Slayer"  # ONE change

print("Welcome,", character_name)
print(character_name, "leveled up!")
print(character_name, "defeated the boss!")
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Top half: "Before" snippet, `"Shadow_Blade"` occurrences highlighted.[^1]
- Bottom half: "After" snippet with `character_name` assignment at top highlighted and reused below.
- Arrow or label: "One change → updates everywhere".

**Audio:**
"With variables, you store the name once, then reuse it everywhere. Now changing the character name is one edit, not a scavenger hunt. Change one line at the top, and the whole game updates. That's the real power of variables: update in one place, affect everything."[^1]

***

### [SLIDE 5: Real‑World Analogy — Best Friend Contact]

**Visual Main:**

```text
Best Friend
Phone: 98765...
Birthday: 12 Jan
Fav snack: ?
```

**Supporting Visuals (Static):**

- Smartphone contacts screen showing one contact called "Best Friend" with a phone number, birthday, and favorite snack field.[^1]
- Small arrow to "Edit contact once → all future calls use new number".

**Audio:**
"Variables are like saving your best friend's contact. You don't memorize their phone number—because you'd get it wrong, call the wrong person, and have an awkward conversation. You save it once as 'Best Friend' and use it forever. When they change their number, you update it once and every call uses the new number. Same idea: store important information once, reference it everywhere."[^1]

***

### [SLIDE 6: Creating Your First Variable]

**Visual Main:**

```python
favorite_snack = "Kale Chips"
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Code line centered in a code editor mockup.[^1]
- Above or below: arrows labeling `favorite_snack` as "variable name" and `"Kale Chips"` as "value".
- Small caption: "This is assignment."

**Audio:**
"Creating a variable is simple. Pick a name—like favorite_snack—use the equals sign, then provide the value. This is called assignment. You're telling Python: 'Whenever I say favorite_snack, I mean Kale Chips.' We're definitely lying to ourselves, but Python trusts us."[^1]

***

### [SLIDE 7: Variables Hold Different Types (Backpack Pockets)]

**Visual Main:**

```python
game_title = "CyberStrike"    # String
max_players = 100             # Integer
progress = 87.5               # Float
is_multiplayer = True         # Boolean
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Large backpack cutaway with four labeled pockets:
    - Phone icon labeled "String".
    - Laptop icon labeled "Integer".
    - Water bottle "0.5 L" labeled "Float".
    - Moldy sandwich labeled "Boolean: True for 'contains mystery'".[^1]
- Arrows from pockets to the corresponding code variables.

**Audio:**
"Variables can store different kinds of data, like pockets in a backpack. Phone in one pocket, laptop in another, water bottle on the side, and that mystery sandwich from last week in the hidden pocket—we're not opening that. Each pocket just holds what you put in. Variables do the same thing."[^1]

***

### [SLIDE 8: The Assignment Symbol]

**Visual Main:**

```python
level = 5
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Big equals sign `=` between "level" and "5" with arrows showing: "Look right first (5) → store into left (level)".[^1]
- Caption: "Instruction, not a math fact."

**Audio:**
"Important: the equals sign isn't saying 'level IS 5' like a math fact. It's an instruction. Here's what Python does: First, it looks at the right side and grabs the value 5. Then it stores that 5 into the variable called level. Right side first, then store in the left side. That's the pattern every time."[^1]

***

### [SLIDE 9: Variables vs Direct Values]

**Visual Main:**

```python
# Direct value (one-time):
print("Visit my channel!")  # shows once, then it's gone

# Variable (stored and reused):
channel_message = "Visit my channel!"
print(channel_message)
print(channel_message)
print(channel_message)
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Left margin tag "One-off" next to first print.[^1]
- Right side: three identical terminal lines `"Visit my channel!"` stacked, arrows back to `channel_message`.
- Caption: "Snap vs saved to camera roll."

**Audio:**
"Printing a value directly is like a Snapchat message. It appears once, then vanishes. Variables are like saving it to your camera roll—you store it once, then reuse it anywhere. We stored the message in channel_message, and now we can print it three times without retyping."[^1]

***

### [SLIDE 10: Key Takeaway]

**Visual Main:**

```python
variable_name = value
# Name = what you call it
# Value = what it remembers
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Two-column annotation: left box "Name (label)", right box "Value (data)".[^1]
- Simple container icon with the label on top and value inside.

**Audio:**
"Variables are named storage containers. Store a value once, then reuse it by name anywhere in your program. Update it in one place, and everything that uses it updates too."[^1]

***

## Video 7: Changing Stored Values

**Duration:** ~135 seconds
**Concept:** Variables can be updated (overwritten)[^1]

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Video 7: Changing Stored Values
```

**Supporting Visuals (Static):**

- Title centered.[^1]
- Icon of a whiteboard being erased and rewritten.

**Audio:**
"Real data changes constantly. Your score changes, your battery changes, your mood changes after 'one more video.' Variables aren't permanent—you can update them whenever you want."[^1]

***

### [SLIDE 2: The Replacement Rule]

**Visual Main:**

```python
score = 100
score = 200  # What happened to 100?
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Two-step panel:
    - Step 1: score box showing "100".
    - Step 2: same box overwritten with "200", "100" faded out.[^1]
- Caption: "New value replaces old value."

**Audio:**
"Key rule: when you assign a new value to a variable, the old value is replaced. Not saved. Not archived. Gone. Variables don't keep memories—ironic, I know. That's actually why they're called variables—because the value inside can vary. It's not locked forever. The old value gets deleted like you never existed. Dramatic, but true."[^1]

***

### [SLIDE 3: Real‑World Analogy — Whiteboard]

**Visual Main:**

```text
TODO: Study Python  (crossed out)
TODO: Watch Cat Videos
```

**Supporting Visuals (Static):**

- Whiteboard illustration: "Study Python" written and crossed out, "Watch Cat Videos" written below in fresh ink.[^1]
- Eraser in hand to emphasize overwrite.

**Audio:**
"Think of a variable like a whiteboard. You write 'Study Python' on it with determination. Then reality hits. You erase it and write 'Watch Cat Videos' because priorities shift. The old text disappears, new text takes its place. Variables work exactly like that: assign a new value, the old one vanishes."[^1]

***

### [SLIDE 4: Step‑by‑Step Update (Tabs)]

**Visual Main:**

```python
youtube_tabs = 1
print(youtube_tabs)

youtube_tabs = 5
print(youtube_tabs)

youtube_tabs = 23
print(youtube_tabs)
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Left: code as above.[^1]
- Right: terminal output `1`, `5`, `23` stacked.
- Underneath: a simple browser window icon that grows busier (1 tab → 5 tabs → 23 tiny tabs).

**Audio:**
"Let's track something we all understand: YouTube tabs. Start with 1 tab open—you're being responsible. Print shows 1. Then 'just one more video' happens. We assign youtube_tabs = 5. That overwrites the 1—it's gone. Print shows 5. An hour later? We assign youtube_tabs = 23 and your browser is crying for mercy. The 5 gets replaced. Print shows 23. Same variable, but each new assignment completely overwrites what was there before. Python doesn't judge your tab addiction."[^1]

***

### [SLIDE 5: Using the Current Value]

**Visual Main:**

```python
followers = 100
print(followers)  # 100

followers = followers + 50
print(followers)  # 150
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Code on left, terminal output (`100` then `150`) on right.[^1]
- Arrow from `followers = followers + 50` to a small breakdown: "Right side: 100 + 50 → 150; Left side: store 150".

**Audio:**
"Here's where it gets powerful: you can use a variable's current value to calculate its new value. Followers starts at 100. Then we say: followers equals followers plus 50. Python reads the RIGHT side first—looks up followers, sees 100, adds 50, gets 150. Then it stores that 150 back into followers. The old 100? Replaced. Now when we print, we see 150. It's the same variable, just updated with math."[^1]

***

### [SLIDE 6: XP Pattern (Games)]

**Visual Main:**

```python
xp = 0
# You defeated an enemy!
xp = xp + 10
print(xp)  # 10

# You defeated another enemy!
xp = xp + 10
print(xp)  # 20
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Code snippet with comments as above.[^1]
- Right side: XP bar graphic going from 0 → 10 → 20 with tick marks.
- Output `10` and `20` shown under the bar.

**Audio:**
"This pattern is everywhere in games. You start with 0 XP. You defeat an enemy. We do: xp equals xp plus 10. Python evaluates the right side first—0 plus 10 equals 10—then shoves that back into xp. Print shows 10. Defeat another enemy, same code runs again. Python reads xp—now 10—adds 10, gets 20, stores it back. The 10 gets overwritten. We're not getting a new XP bar each time; the old value just keeps getting replaced."[^1]

***

### [SLIDE 7: Phone Battery]

**Visual Main:**

```text
Battery: 100% → 50% → 20% → 1%
```

**Supporting Visuals (Static):**

- Four battery icons in a row with levels 100%, 50%, 20%, 1%.[^1]
- Small caption: "Same icon, changing value."

**Audio:**
"Your phone battery is basically a variable. Same battery icon, different value inside—and somehow it always drops faster when you need it most."[^1]

***

### [SLIDE 8: Key Takeaway]

**Visual Main:**

```python
x = 5
x = 10      # 5 is gone
x = x + 1   # Now 11
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Simple timeline: "5 → 10 → 11" above a variable box labeled `x`.[^1]
- Caption: "New assignments overwrite; math builds on current value."

**Audio:**
"Variables update constantly. New values replace old ones. And you can use the current value to compute the next value. That's how programs track a changing world."[^1]

***

## Video 8: Naming Rules

**Duration:** ~135 seconds
**Concept:** Variable names follow rules (and good style saves you later)[^1]

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Video 8: Naming Rules
```

**Supporting Visuals (Static):**

- Title centered.[^1]
- Python as a small "name tag" icon with `player_score` written clearly.

**Audio:**
"You want variables for score, username, level, and everything else. But Python is picky about names. Use the wrong format and your code crashes instantly. Let's learn the rules so Python doesn't have a meltdown."[^1]

***

### [SLIDE 2: The Club Bouncer]

**Visual Main:**

```text
Python = Strict Bouncer
```

**Supporting Visuals (Static):**

- Cartoon Python snake dressed as a bouncer holding a clipboard labeled "Valid names only".[^1]
- A variable name with sandals and a hyphen (`my-score`) being turned away at a rope barrier.

**Audio:**
"Python is like a strict nightclub bouncer. It has a guest list. Your variable name shows up wearing sandals and a hyphen? Not getting in."[^1]

***

### [SLIDE 3: Rule 1 — Allowed Characters (and why)]

**Visual Main:**

```python
player_score = 100       # OK
level2_boss = "Dragon"  # OK

my-score = 50           # NO
# Python thinks: my - score  (subtraction?)

my score = 50           # NO
# Python thinks: two separate names: my and score
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Code panel with good lines highlighted green, bad lines red.[^1]
- Small math bubble showing `my - score` above `my-score`.
- Label: "Only letters, numbers, underscores."

**Audio:**
"Rule one: only letters, numbers, and underscores. A hyphen looks like subtraction, so Python thinks you're doing math. A space looks like two separate names. Underscores are the safe connector."[^1]

***

### [SLIDE 4: Rule 2 — Don’t Start With a Number]

**Visual Main:**

```python
1st_place = "Me"   # NO
place_1 = "Me"     # OK
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Code snippet with `1st_place` underlined red and `place_1` green.[^1]
- Tiny caption: "First character must be letter or underscore."

**Audio:**
"Rule two: don't start with a number. Python sees a leading number and assumes you're doing math, not naming something."[^1]

***

### [SLIDE 5: Rule 3 — Case Sensitivity + Convention]

**Visual Main:**

```python
score = 100
Score = 500
SCORE = 9000
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Three labeled boxes: `score`, `Score`, `SCORE`, each with its different value.[^1]
- Underneath, a recommended-style example: `player_score` labeled "Python style: lowercase_with_underscores".

**Audio:**
"Rule three: Python is case-sensitive—these are three different variables. It's like three people with the same name who get mad if you call them the wrong version. Python convention is to use lowercase_with_underscores, so names like player_score are the usual style."[^1]

***

### [SLIDE 6: Rule 4 — Reserved Words]

**Visual Main:**

```python
# This breaks everything:
print = "oops"  # NO
if = "nope"     # NO
for = "never"   # NO
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Two mini panels:
    - Panel A ("Works"): `print("Hello")` with a check.
    - Panel B ("Breaks"): `print = "oops"` followed by `print("Hello")` with an error icon.[^1]
- Caption: "Some words are already taken by Python."

**Audio:**
"Rule four: some words are already taken—print, if, for, while. Python called dibs on these. These are words that Python uses, so you shouldn’t use them. You have already learned about the print command. The others you will learn soon."[^1]

***

### [SLIDE 7: Good Names vs Painful Names]

**Visual Main:**

```python
player_score = 1500
lives_remaining = 3

x = 1500
n = 3
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Left column titled "Clear": `player_score`, `lives_remaining`.[^1]
- Right column titled "Painful": `x`, `n`.
- Future-you character holding head in hands next to the right column.

**Audio:**
"Beyond the rules: use descriptive names. player_score is clear. But 'x'? Is that a coordinate? A score? The number of times you’ve rage-quit today? Future you will open this code and whisper: 'Who wrote this?' Spoiler: it was you."[^1]

***

### [SLIDE 8: File Naming Parallel]

**Visual Main:**

```text
homework_final_FINAL_v3_REAL.pdf
vs
math_assignment_jan_2024.pdf
```

**Supporting Visuals (Static):**

- Two file icons side by side: one with the chaotic long name, one with the clean structured name.[^1]
- Caption: "Good names save time later."

**Audio:**
"It’s like naming computer files. Ever seen a folder full of files named ‘homework_final_FINAL_v3_REAL_actually_final.pdf’? Chaos. Or clear names like ‘math_assignment_jan_2024.pdf’? You find it instantly. Good variable names are self-explanatory—you know what’s inside without guessing."[^1]

***

### [SLIDE 9: Key Takeaway]

**Visual Main:**

```text
Letters, numbers, underscores
Start with letter/underscore
Case-sensitive
Avoid reserved words
Use clear, readable names
```

**Supporting Visuals (Static):**

- Simple checklist with these five bullets and checkmarks.[^1]
- Small example at bottom: `player_score` with a green tick.

**Audio:**
"Letters, numbers, underscores. Start with a letter or underscore. Case-sensitive. Avoid reserved words. And choose names that make your code readable."[^1]

***

## Video 9.1: Understanding Strings (Why “String”?)

**Duration:** ~125 seconds
**Concept:** Strings are text in quotes[^1]

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Video 9.1: Understanding Strings
```

**Supporting Visuals (Static):**

- Title centered.[^1]
- Icon of text `"HELLO"` hanging like beads on a string.

**Audio:**
"In Python, text data is called a String. But why? Let's break down what strings are, why they have that name, and why you'll use them constantly."[^1]

***

### [SLIDE 2: What’s a String?]

**Visual Main:**

```python
username = "NotAHacker"   # Definitely trustworthy
status = "this is fine"   # (narrator: it was not fine)
item = "Health Potion"    # Actually just water
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Code snippet with comments visible but slightly faded to keep focus on quoted text.[^1]
- Small icons next to each: user avatar, fire/this‑is‑fine meme hint, potion bottle.

**Audio:**
"Strings are text wrapped in quotes. Usernames, messages, item names—anything made of characters is a string. Python doesn't judge what you type. It just stores it."[^1]

***

### [SLIDE 3: Why “String”? (Beads Metaphor)]

**Visual Main:**

```python
greeting = "HELLO"
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Central visual: beads labeled H‑E‑L‑L‑O on a single necklace string.[^1]
- Arrow from beads to the word "String of characters".

**Audio:**
"It's called a string because it's a string of characters—like beads on a necklace. HELLO is five characters in order. Somebody way back thought that's how it looked, and we've been living with it ever since. Kind of like how we call it a pineapple even though it's neither a pine nor an apple."[^1]

***

### [SLIDE 4: Quotes Freeze Text]

**Visual Main:**

```python
message = "Hello World"
username = "Player1"
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Code snippet shown.[^1]
- Around `"` characters, a small ice/freeze icon indicating "frozen text".
- Caption: "Quotes stop Python from 'thinking'—just store exactly."

**Audio:**
"Quotes tell Python: 'Take a time-out—don't think, just remember exactly what you see.' The moment Python sees an opening quote, it stops trying to understand or execute anything. It just collects every character—letters, spaces, symbols, whatever—until it sees the closing quote. Then it stores all of that as frozen text. No interpretation. No commands. Just pure text, saved exactly as written."[^1]

***

### [SLIDE 5: Even Math Gets Frozen]

**Visual Main:**

```python
calculation = "10 + 5"
print(calculation)
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Code snippet with `"10 + 5"` clearly inside quotes.[^1]
- Terminal output showing literal `10 + 5` (not 15).
- Small note: "Text, not math."

**Audio:**
"Here's the weird part: even if you put math inside quotes, Python won't calculate it. It just stores the characters '1', '0', ' ', '+', ' ', '5'. You get the text '10 + 5', not the answer 15. Quotes freeze everything into text."[^1]

***

### [SLIDE 6: Quotes Are Required]

**Visual Main:**

```python
name = "Alex"   # OK
name = Alex     # ERROR
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Second line highlighted red with a small "NameError" bubble.[^1]
- Caption: "Without quotes, Python thinks Alex is a variable name."

**Audio:**
"Without quotes, Python assumes you're referring to a variable named Alex. If Alex doesn't exist, Python complains. Quotes make it literal text."[^1]

***

### [SLIDE 7: Key Takeaway]

**Visual Main:**

```python
"Hello"  # String (text)
Hello    # Not a string, just a mysterious word to Python
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Code-style box with comments exactly as above.[^1]
- Small highlight on the quotes as the key difference.

**Audio:**
"Strings are text in quotes. Quotes freeze text so Python stores it exactly."[^1]

***

## Video 9.2: Understanding Numbers (Integers \& Floats)

**Duration:** ~115 seconds
**Concept:** Integers vs floats, and why mixing types breaks things[^1]

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Video 9.2: Understanding Numbers
```

**Supporting Visuals (Static):**

- Title centered.[^1]
- Two big number tokens: `42` labeled "int", `3.14` labeled "float".

**Audio:**
"Now let's talk about actual numbers. Python has integers for whole numbers and floats for decimals. Mixing numbers with strings is where the comedy—and the errors—begin."[^1]

***

### [SLIDE 2: Integers (Whole Numbers)]

**Visual Main:**

```python
lives = 3
score = 1000
level = 42
players_online = 100
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Game HUD elements: hearts with "3", big score "1000", level badge "42", player count "100".[^1]
- Caption: "Counting things? Use integers."

**Audio:**
"Integers are whole numbers. Great for counting: lives, scores, levels, number of players. You can't have 2.5 lives. That's not how games—or life—works."[^1]

***

### [SLIDE 3: Floats (Decimals)]

**Visual Main:**

```python
price = 9.99
health = 87.5
success_rate = 0.75
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Price tag "₹9.99" or "9.99".
- Health bar at 87.5%, numeric label "87.5".
- Progress ring or percentage bar labeled "75%".[^1]

**Audio:**
"Floats are decimals. Great for prices, percentages, and anything that needs precision. That dot is the clue: decimal point equals float."[^1]

***

### [SLIDE 4: Numbers Don’t Use Quotes]

**Visual Main:**

```python
age = 25      # number
age = "25"    # string

print(25 + 5)  # OK: 30
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Left: `age = 25` boxed with label "number".
- Middle: `age = "25"` boxed with label "string".
- Bottom: terminal showing `30`.[^1]
- Caption: "Quotes turn numbers into text."

**Audio:**
"Critical difference: numbers have no quotes. Put quotes around a number and you've turned it into text. Without quotes, 25 plus 5 gives you 30. With quotes, '25' is frozen text—you can't do math with it. Quotes change everything."[^1]

***

### [SLIDE 5: Mixing Types (Blender)]

**Visual Main:**

```python
print(10 / 2)       # OK: 5.0
print("hello" / 2)  # ERROR
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Small blender illustration:
    - Fruit labeled "numbers" blending smoothly.
    - Rock labeled `"hello"` jamming the blender.[^1]
- Terminal output: `5.0` then a `TypeError` line.

**Audio:**
"Think of math like a blender. Numbers are fruit—blend smoothly. Strings are rocks—blend that and something breaks. Python doesn't know what 'divide text' means, so it throws a TypeError and stops instead of guessing."[^1]

***

### [SLIDE 6: When to Use Which]

**Visual Main:**

```python
lives = 3        # integer
rating = 4.5     # float
username = "Neo" # string
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Three icons: heart (lives), star rating (4.5 stars), user avatar ("Neo").[^1]
- Each icon linked to its code line and type label.

**Audio:**
"Simple rule: text in quotes equals string. Whole numbers equal int. Decimals equal float. Match the type to the job and your code behaves."[^1]

***

### [SLIDE 7: Key Takeaway]

**Visual Main:**

```python
42      # int
3.14    # float
"42"    # string
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Three boxes side by side labeled "int", "float", "string".[^1]
- Caption: "Same digits, different types."

**Audio:**
"Two number types: integers and floats. Don't put quotes around numbers unless you want text."[^1]

***

## Video 10: Working with Multiple Variables

**Duration:** ~130 seconds
**Concept:** Real programs use many variables together (including True/False)[^1]

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Video 10: Working with Multiple Variables
```

**Supporting Visuals (Static):**

- Title centered.[^1]
- Character profile card silhouette with several labeled fields (name, level, HP, etc.).

**Audio:**
"One variable is lonely. Real programs juggle lots of variables at once: username, score, level, settings, inventory—everything. Let's build a character profile to see how variables work together."[^1]

***

### [SLIDE 2: Character Profile (Multiple Types)]

**Visual Main:**

```python
hero_name = "Swift_Shadow_Assassin"
hero_level = 1
hero_speed = 0.1
hero_weapon = "Rusty Spoon"
runs_from_combat = True
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Simple character sheet layout:
    - Name, Level, Speed, Weapon, "Runs from combat?" fields filled with the variable values.[^1]
- Icons: hooded figure, level badge, speed shoe, rusty spoon, running man.

**Audio:**
"Meet our hero. Great name… questionable stats. Notice we're using different types: text for names, numbers for stats, and True/False for behavior. That True/False type is called a Boolean—basically an on/off switch."[^1]

***

### [SLIDE 3: Backpack Pockets (Independence)]

**Visual Main:**

```text
Each variable = its own pocket
```

**Supporting Visuals (Static):**

- Backpack with clearly separated labeled pockets: `hero_name`, `hero_level`, `hero_speed`, `hero_weapon`, `runs_from_combat`.[^1]
- Caption: "Changing one pocket doesn’t change the others."

**Audio:**
"Think of each variable like its own pocket. Weapon pocket, speed pocket, name pocket. Changing one pocket doesn't magically change the others."[^1]

***

### [SLIDE 4: Printing Multiple Values (Comma Method)]

**Visual Main:**

```python
print("Hero:", hero_name)
print("Level:", hero_level)
print("Weapon:", hero_weapon)
print("Runs from combat:", runs_from_combat)
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Code on left, terminal output on right:
`Hero: Swift_Shadow_Assassin` etc.[^1]
- Small note: "Commas add spaces between pieces automatically."

**Audio:**
"Use commas in print() to show labels and values together. print() handles spacing for you. Clean, readable output."[^1]

***

### [SLIDE 5: Combining Strings (Superglue)]

**Visual Main:**

```python
title = "The Legendary"
full_name = hero_name + " " + title
print(full_name)
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Code snippet as above.[^1]
- Terminal output: `Swift_Shadow_Assassin The Legendary`.
- Visual: three text blocks ("Swift_Shadow_Assassin", `" "`, "The Legendary") being glued together into one banner.

**Audio:**
"You can glue strings together with plus. Some people call this concatenation, but think of it as superglue for text. Here's how it works: Python takes hero_name—that's 'Swift_Shadow_Assassin'—adds a space, then adds 'The Legendary'. They stick together into one long string. Now our cowardly hero has a properly formatted title."[^1]

***

### [SLIDE 6: Variables Stay Independent]

**Visual Main:**

```python
hero_speed = 0.1
enemy_speed = 50.0

hero_speed = 0.05
print(enemy_speed)  # still 50.0
```

PRODUCE OUTPUT: TRUE

**Supporting Visuals (Static):**

- Code block.[^1]
- Two separate speed gauges:
    - Hero speed gauge changing from 0.1 to 0.05.
    - Enemy speed gauge locked at 50.0.
- Arrow/label: "Updating hero_speed does not touch enemy_speed."

**Audio:**
"Changing hero_speed doesn't change enemy_speed. Variables don't affect each other unless you explicitly connect them. They're separate containers."[^1]

***

### [SLIDE 7: Stay Organized (Prefixes)]

**Visual Main:**

```python
player_hp = 50
player_xp = 500

enemy_hp = 500
enemy_xp = 1000
```

PRODUCE OUTPUT: FALSE

**Supporting Visuals (Static):**

- Two columns: "Player" vs "Enemy" with HP and XP under each.[^1]
- Clear grouping lines showing the prefixes `player_` and `enemy_`.

**Audio:**
"Organization matters. Prefixes like player_ and enemy_ keep your variables from turning into a confusing soup. The player has 50 HP, the enemy has 500. Accidentally swapping those would make for a very short, very one-sided game."[^1]

***

### [SLIDE 8: Key Takeaway]

**Visual Main:**

```text
Many variables
Different types
One coherent system
```

**Supporting Visuals (Static):**

- Full character sheet recap with all fields: name, level, speed, weapon, behavior flags, HP/XP.[^1]
- Caption: "Real programs juggle lots of variables together."

**Audio:**
"Real programs coordinate many variables of different types. Name them clearly, keep them organized, and use them together to describe bigger systems."[^1]

***

_End of Arc 2 static visual specification._
<span style="display:none">[^10][^11][^12][^13][^2][^3][^4][^5][^6][^7][^8][^9]</span>

<div align="center">⁂</div>

[^1]: Arc2-V5.4-FINAL-1.md

[^2]: __Arc 2_ Memory \& Storage - REVISED (Casual \& Humo.docx

[^3]: Course Plan.docx

[^4]: I-need-to-plan-videos-for-Chapter-X-of-the-pytho.pdf

[^5]: Course-Plan.docx

[^6]: Arc-1_-Basic-Commands-REVISED-Enhanced-Humor.docx

[^7]: Arc-1_-Basic-Commands-COMPLETE-REVISED-VERSION.docx

[^8]: Arc2-Final-REVISED-v3.1.docx

[^9]: give-me-full-script-as-per-your-suggestions.docx

[^10]: Arc2-V5.1.md

[^11]: Arc-3_-Operations-Calculations-COMPLETE-SCRIPT.md

[^12]: Arc3-FullScript-v5.0.md

[^13]: Arc-1_-Basic-Commands-COMPLETE-REVISED-VERSION.md

