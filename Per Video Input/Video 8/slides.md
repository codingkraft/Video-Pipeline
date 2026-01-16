# Naming Rules

## Slide 1: Title Screen
**Visual:** "Video 8: Naming Rules"
**Audio:** You want variables for score, username, level, and everything else. But Python is picky about names. Use the wrong format and your code crashes instantly. Let's learn the rules so Python doesn't have a meltdown.
**Duration:** 10s

---

## Slide 2: The Club Bouncer
**Visual:** Python as a bouncer with a clipboard
**Audio:** Python is like a strict nightclub bouncer. It has a guest list. Your variable name shows up wearing sandals and a hyphen? Not getting in.
**Duration:** 14s

---

## Slide 3: Rule 1 — Allowed Characters (and why)
**Visual:** ```python
player_score = 100   # OK
level2_boss = "Dragon"  # OK

my-score = 50        # NO
# Python thinks: my - score  (subtraction?)

my score = 50        # NO
# Python thinks: two separate names: my and score
```
**Audio:** Rule one: only letters, numbers, and underscores. A hyphen looks like subtraction, so Python thinks you're doing math. A space looks like two separate names. Underscores are the safe connector.
**Duration:** 18s

---

## Slide 4: Rule 2 — Don't Start With a Number
**Visual:** ```python
1st_place = "Me"   # NO
place_1 = "Me"     # OK
```
**Audio:** Rule two: don't start with a number. Python sees a leading number and assumes you're doing math, not naming something.
**Duration:** 12s

---

## Slide 5: Rule 3 — Case Sensitivity + Python Convention
**Visual:** ```python
score = 100
Score = 500
SCORE = 9000
```
**Audio:** Rule three: Python is case-sensitive—these are three different variables. It's like three people with the same name who get mad if you call them the wrong version. Python convention is to use lowercase_with_underscores, so names like player_score are the usual style.
**Duration:** 16s

---

## Slide 6: Rule 4 — Reserved Words
**Visual:** ```python
print = "oops"  # NO
if = "nope"     # NO
for = "never"   # NO
```
**Audio:** Rule four: some words are already taken—print, if, for, while. Python called dibs. Choose a different name.
**Duration:** 12s

---

## Slide 7: Good Names vs Painful Names
**Visual:** ```python
player_score = 1500
lives_remaining = 3

x = 1500
n = 3
```
**Audio:** Beyond the rules: use descriptive names. player_score is clear. x is a mystery. Future you will open this code and whisper: 'Who wrote this?' Spoiler: it was you.
**Duration:** 18s

---

## Slide 8: File Naming Parallel
**Visual:** homework_final_FINAL_v3_REAL.pdf vs math_assignment_jan_2024.pdf
**Audio:** It's like naming files. Chaos names waste time. Clear names save time. Variables are the same.
**Duration:** 12s

---

## Slide 9: Key Takeaway
**Visual:** Rules list + "lowercase_with_underscores"
**Audio:** Letters, numbers, underscores. Start with a letter or underscore. Case-sensitive. Avoid reserved words. And choose names that make your code readable.
**Duration:** 8s

---

## Slide 1: Title Screen
**Visual:** "Video 9.1: Understanding Strings"
**Audio:** In Python, text data is called a String. But why? Let's break down what strings are, why they have that name, and why you'll use them constantly.
**Duration:** 10s

---

## Slide 2: What's a String?
**Visual:** ```python
username = "NotAHacker"  # Definitely trustworthy
status = "this is fine"  # (narrator: it was not fine)
item = "Health Potion"   # Actually just water
```
**Audio:** Strings are text wrapped in quotes. Usernames, messages, item names—anything made of characters is a string. Python doesn't judge what you type. It just stores it.
**Duration:** 15s

---

## Slide 3: Why "String"? (Beads Metaphor)
**Visual:** H–E–L–L–O as beads on a string
**Audio:** It's called a string because it's a string of characters—like beads on a necklace. HELLO is five characters in order. Somebody named it that, and we've been living with it ever since.
**Duration:** 18s

---

## Slide 4: Quotes Freeze Text (Screenshot analogy)
**Visual:** ```python
math_as_text = "2 + 2"
```

(Show calculator vs screenshot visual)
**Audio:** Quotes tell Python: 'This is literal text.' Even if it looks like math, Python won't calculate it. It stores the characters exactly as written—like a screenshot of a calculator, not a real calculation. You can't tap a screenshot and expect it to do math. That would be like expecting a photograph of a sandwich to be edible.
**Duration:** 20s

---

## Slide 5: Quotes Are Required
**Visual:** ```python
name = "Alex"  # OK
name = Alex    # ERROR (Python thinks Alex is a variable)
```
**Audio:** Without quotes, Python assumes you're referring to a variable named Alex. If Alex doesn't exist, Python complains. Quotes make it literal text.
**Duration:** 16s

---

## Slide 6: Key Takeaway
**Visual:** ```python
"Hello"  # String (text)
Hello    # not a string, just a mysterious word to Python
```
**Audio:** Strings are text in quotes. Quotes freeze text so Python stores it exactly.
**Duration:** 10s

---

## Slide 1: Title Screen
**Visual:** "Video 9.2: Understanding Numbers"
**Audio:** Now let's talk about actual numbers. Python has integers for whole numbers and floats for decimals. Mixing numbers with strings is where the comedy—and the errors—begin.
**Duration:** 10s

---

## Slide 2: Integers (Whole Numbers)
**Visual:** ```python
lives = 3
score = 1000
level = 42
players_online = 100
```
**Audio:** Integers are whole numbers. Great for counting: lives, scores, levels, number of players. You can't have 2.5 lives. That's not how games—or life—works.
**Duration:** 14s

---

## Slide 3: Floats (Decimals)
**Visual:** ```python
price = 9.99
health = 87.5
success_rate = 0.75
```
**Audio:** Floats are decimals. Great for prices, percentages, and anything that needs precision. That dot is the clue: decimal point equals float.
**Duration:** 14s

---

## Slide 4: Numbers Don't Use Quotes
**Visual:** ```python
age = 25      # number
age = "25"    # string

print(25 + 5)  # OK: 30
```
**Audio:** Critical difference: numbers have no quotes. Put quotes around a number and you've turned it into text. Without quotes, 25 plus 5 gives you 30. With quotes, '25' is frozen text—you can't do math with it. Quotes change everything.
**Duration:** 16s

---

## Slide 5: Mixing Types (Blender)
**Visual:** ```python
print(10 / 2)        # OK: 5.0
print("hello" / 2)   # ERROR
```

(Show blender visual: fruit = numbers, rock labeled "Hello" = strings)
**Audio:** Think of math like a blender. Numbers are fruit—blend smoothly. Strings are rocks—blend that and something breaks. Python doesn't know what 'divide text' means, so it throws a TypeError and stops instead of guessing.
**Duration:** 20s

---

## Slide 6: When to Use Which
**Visual:** ```python
lives = 3        # integer
rating = 4.5     # float
username = "Neo" # string
```
**Audio:** Simple rule: text in quotes equals string. Whole numbers equal int. Decimals equal float. Match the type to the job and your code behaves.
**Duration:** 14s

---

## Slide 7: Key Takeaway
**Visual:** ```python
42      # int
3.14    # float
"42"    # string
```
**Audio:** Two number types: integers and floats. Don't put quotes around numbers unless you want text.
**Duration:** 10s
