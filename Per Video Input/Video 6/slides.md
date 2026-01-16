# Storing Data in Memory

## Slide 1: Title Screen
**Visual:** "Video 6: Storing Data in Memory"
**Audio:** You're building a game and need to remember the player's username, score, and level. Print them once? They're gone. You need to store data so you can use it throughout your code. That's what variables do—Python's little memory system.
**Duration:** 10s

---

## Slide 2: The Hardcode Trap
**Visual:** ```python
# Hardcoded name everywhere...
# ...and imagine 50 more lines like this.
print("Welcome, Shadow_Blade!")
print("Shadow_Blade leveled up!")
print("Shadow_Blade defeated the boss!")
print("Shadow_Blade's score: 1000")
```
**Audio:** This works… until you change your mind. And you will. Because naming a character is a sacred ritual: you pick something cool, then immediately regret it.
**Duration:** 14s

---

## Slide 3: The "Missed One" Bug
**Visual:** ```python
# Rename time! Shadow_Blade -> Dragon_Slayer
print("Welcome, Dragon_Slayer!")
print("Shadow_Blade leveled up!")  # <-- OOPS. Missed one.
print("Dragon_Slayer defeated the boss!")
print("Dragon_Slayer's score: 1000")
```
**Audio:** This is the classic bug: you update most lines, miss one, and now your game has identity issues. It's not broken in a dramatic way—it's broken in an embarrassing way.
**Duration:** 16s

---

## Slide 4: The Variable Fix (Show payoff)
**Visual:** ```python
character_name = "Shadow_Blade"

print("Welcome,", character_name)
print(character_name, "leveled up!")
print(character_name, "defeated the boss!")
print(character_name, "'s score:", 1000)
```
**Audio:** With variables, you store the name once, then reuse it everywhere. Now changing the character name is one edit, not a scavenger hunt.
**Duration:** 16s

---

## Slide 5: Change It Once
**Visual:** ```python
character_name = "Dragon_Slayer"  # One change

print("Welcome,", character_name)
print(character_name, "leveled up!")
print(character_name, "defeated the boss!")
```
**Audio:** Change one line at the top, and the whole game updates. That's the real power of variables: update in one place, affect everything.
**Duration:** 14s

---

## Slide 6: Real-World Analogy — Phone Contacts
**Visual:** Contact card: Mom → phone/email/birthday
**Audio:** Variables are like phone contacts. You don't retype your mom's number every time you call—because you'd get it wrong by digit three. You save it once as 'Mom' and reuse it forever. If the number changes, you update it once and every call uses the new number.
**Duration:** 18s

---

## Slide 7: Creating Your First Variable
**Visual:** ```python
favorite_snack = "Kale Chips"
```
**Audio:** Creating a variable is simple. Pick a name—like favorite_snack—use the equals sign, then provide the value. This is called assignment. You're telling Python: 'Whenever I say favorite_snack, I mean Kale Chips.' We're definitely lying to ourselves, but Python trusts us.
**Duration:** 16s

---

## Slide 8: Variables Hold Different Types (Backpack Pockets)
**Visual:** Backpack cutaway with pockets: phone, laptop, water bottle, and a **mystery sandwich with visible mold** in a hidden pocket (make the grossness obvious).
**Audio:** Variables can store different kinds of data, like pockets in a backpack. Phone in one pocket, laptop in another, water bottle on the side, and that mystery sandwich from last week in the hidden pocket—we're not opening that. Each pocket just holds what you put in. Variables do the same thing.
**Duration:** 16s

---

## Slide 9: The Assignment Symbol
**Visual:** ```python
level = 5
```
**Audio:** Important: the equals sign isn't saying 'level IS 5' like a math fact. It's an instruction. Here's what Python does: First, it looks at the right side and grabs the value 5. Then it stores that 5 into the variable called level. Right side first, then store in the left side. That's the pattern every time.
**Duration:** 16s

---

## Slide 10: Variables vs Direct Values
**Visual:** ```python
# Direct value (one-time):
print("Visit my channel!")  # shows once, then it's gone

# Variable (stored and reused):
channel_message = "Visit my channel!"
print(channel_message)
print(channel_message)
print(channel_message)
```
**Audio:** Printing a value directly is like a Snapchat message. It appears once, then vanishes. Variables are like saving it to your camera roll—you store it once, then reuse it anywhere. We stored the message in channel_message, and now we can print it three times without retyping.
**Duration:** 16s

---

## Slide 11: Key Takeaway
**Visual:** ```python
variable_name = value
# Name = what you call it
# Value = what it remembers
```
**Audio:** Variables are named storage containers. Store a value once, then reuse it by name anywhere in your program. Update it in one place, and everything that uses it updates too.
**Duration:** 10s
