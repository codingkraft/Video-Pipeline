# Code Block 1 (Slide 3: Rule 1 — Allowed Characters (and why))
```python
player_score = 100   # OK
level2_boss = "Dragon"  # OK

my-score = 50        # NO
# Python thinks: my - score  (subtraction?)

my score = 50        # NO
# Python thinks: two separate names: my and score
```

---

# Code Block 2 (Slide 4: Rule 2 — Don't Start With a Number)
```python
1st_place = "Me"   # NO
place_1 = "Me"     # OK
```

---

# Code Block 3 (Slide 5: Rule 3 — Case Sensitivity + Python Convention)
```python
score = 100
Score = 500
SCORE = 9000
```

---

# Code Block 4 (Slide 6: Rule 4 — Reserved Words)
```python
print = "oops"  # NO
if = "nope"     # NO
for = "never"   # NO
```

---

# Code Block 5 (Slide 7: Good Names vs Painful Names)
```python
player_score = 1500
lives_remaining = 3

x = 1500
n = 3
```

---

# Code Block 6 (Slide 2: What's a String?)
```python
username = "NotAHacker"  # Definitely trustworthy
status = "this is fine"  # (narrator: it was not fine)
item = "Health Potion"   # Actually just water
```

---

# Code Block 7 (Slide 3: Why "String"? (Beads Metaphor))
```python
greeting = "HELLO"
```

---

# Code Block 8 (Slide 4: Quotes Freeze Text (Screenshot analogy))
```python
math_as_text = "2 + 2"
```

---

# Code Block 9 (Slide 5: Quotes Are Required)
```python
name = "Alex"  # OK
name = Alex    # ERROR (Python thinks Alex is a variable)
```

---

# Code Block 10 (Slide 6: Key Takeaway)
```python
"Hello"  # String (text)
Hello    # not a string, just a mysterious word to Python
```

---

# Code Block 11 (Slide 2: Integers (Whole Numbers))
```python
lives = 3
score = 1000
level = 42
players_online = 100
```

---

# Code Block 12 (Slide 3: Floats (Decimals))
```python
price = 9.99
health = 87.5
success_rate = 0.75
```

---

# Code Block 13 (Slide 4: Numbers Don't Use Quotes)
```python
age = 25      # number
age = "25"    # string

print(25 + 5)  # OK: 30
```

# Expected Output:
30

---

# Code Block 14 (Slide 5: Mixing Types (Blender))
```python
print(10 / 2)        # OK: 5.0
print("hello" / 2)   # ERROR
```

# Expected Output:
5.0
TypeError: unsupported operand type(s) for /: 'str' and 'int'

---

# Code Block 15 (Slide 6: When to Use Which)
```python
lives = 3        # integer
rating = 4.5     # float
username = "Neo" # string
```

---

# Code Block 16 (Slide 7: Key Takeaway)
```python
42      # int
3.14    # float
"42"    # string
```

---
