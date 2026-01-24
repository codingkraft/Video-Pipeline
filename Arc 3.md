<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Arc 3: Operations & Calculations — STATIC VISUAL VERSION (v6.2)

_All visuals below are specified for **single static images** per slide, with simple, uncluttered compositions suitable for NotebookLM image generation. No video or slide numbers appear in visuals._

***

## 🎯 REQUIRED PATH (Main Quest)

All required videos display a small badge: `🔵 MAIN QUEST` in a corner of the slide.

***

## Video 11: Python Math Basics

**Duration:** ~110–120 seconds
**Concept:** The four basic operators and division's decimal quirk

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Python Math Basics
🔵 MAIN QUEST
```

**Slide Duration:** 10–12 seconds

**Supporting Visuals (Static):**

- Central object: Large calculator or terminal window icon (single focal point).
- Around it: Four operator symbols `+  -  *  /` floating or orbiting like a design element.
- Small Python logo in one corner; `🔵 MAIN QUEST` badge in another.
- Clean gradient or flat background, minimal text overlay.

**Audio:**
"You know how to do math. You've known since you were five. But now you need to tell a computer to do it. Python uses the same symbols you'd expect—except division, which has one tiny rule that might annoy you. We'll see it in a second."

**Audio Duration:** 12 seconds

***

### [SLIDE 2: The Basic Four]

**Visual Main:**

```python
# Addition
score = 100 + 50
print(score)

# Subtraction
battery = 100 - 30
print(battery)

# Multiplication
total_cost = 12 * 3
print(total_cost)

# Division
bill_split = 120 / 4
print(bill_split)
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 20–24 seconds

**Supporting Visuals (Static):**

- Two‑column layout: code block on the left (small font, clean).
- Right side: Four **equal-sized flat cards**, one per operation, arranged in a 2×2 grid.
    - Card 1: Wallet icon, label "Add", result "150".
    - Card 2: Battery icon, label "Subtract", result "70".
    - Card 3: Tickets icon, label "Multiply", result "36".
    - Card 4: Bill icon, label "Divide", result "30.0" (with `.0` slightly highlighted).
- Each card: simple flat icon, minimal text, high contrast background.

**Audio:**
"Plus, minus, star for multiply, slash for divide. 100 plus 50 is 150. 100 minus 30 is 70. Twelve times three is thirty-six. One-twenty divided by four is thirty. Wait—thirty point zero? Why the decimal? Because Python doesn't trust you with division."

**Audio Duration:** 20 seconds

***

### [SLIDE 3: Division's Decimal Obsession]

**Visual Main:**

```python
print(10 / 2)   # 5.0 (not 5)
print(8 / 4)    # 2.0 (not 2)
print(100 / 10) # 10.0 (not 10)
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 18–22 seconds

**Supporting Visuals (Static):**

- Three boxes arranged horizontally, each showing one calculation.
- Each box: "10 ÷ 2" on one line, **large `.0` result below** (emphasized with bright color, 1.5–2x normal text size, very high contrast).
- Faded/ghosted integer result (e.g., "5") in background, de‑emphasized.
- Cartoon Python snake (judge wig, "Precision Police" badge) in lower corner.
- Minimal background (neutral gray or pale blue), no busy courtroom detail.

**Audio:**
"In Python 3, division ALWAYS gives you a decimal. Always. Ten divided by two? Five point zero. Eight divided by four? Two point zero. Python assumes you might need precision, so it slaps a decimal on everything. You can't stop it. You can only accept it. Get used to it—this is your life now."

**Audio Duration:** 20 seconds

***

### [SLIDE 4: Updating Variables Like a Pro]

**Visual Main:**

```python
wallet = 100

wallet = wallet + 50   # Payday!
wallet = wallet - 20   # Coffee addiction
wallet = wallet - 15   # Uber

print(wallet)  # 115
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 18–22 seconds

**Supporting Visuals (Static):**

- Code block on left (small, clean).
- Right side: Vertical timeline (4 checkpoint nodes) with wallet icon at start.
    - Node 1: "Start", value "100".
    - Node 2: "+50 Payday", value "150" (money-bag icon).
    - Node 3: "–20 Coffee", value "130" (coffee-cup icon).
    - Node 4: "–15 Uber", value "115" (car icon).
- Connecting line or arrows between nodes; final value highlighted.
- Simple, readable, no clutter.

**Audio:**
"Real programs update values over time. Wallet starts at 100. Payday adds 50—now 150. Coffee costs 20—down to 130. Uber costs 15—down to 115. Each line grabs the current value, does one operation, stores it back. Your wallet is just a variable that goes up and down. Mostly down."

**Audio Duration:** 20 seconds

***

### [SLIDE 5: The Math Order Trap]

**Visual Main:**

```python
result = 10 + 5 * 2
print(result)
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 18–22 seconds

**Supporting Visuals (Static):**

- **Minimal on-slide text.** Visual hierarchy does most of the work.
- Left half: "10 + 5 × 2" expression, below it big red "30" with red X. Tiny label: "Read Left-to-Right".
- Right half: Same expression "10 + 5 × 2", with "5 × 2" circled/highlighted. Below: big green "20" with checkmark. Tiny label: "Python's Math".
- Small Python snake character on right side (teacher pose).
- **Micro-note** at bottom: "In Python: × is *, ÷ is /" (one line, small font).

**Audio:**
"Quick warning. Ten plus five times two equals twenty. If you read text left-to-right—natural for reading—you'd get thirty. But mathematics has rules. Multiplication before addition. Python follows these rules. Not Python being difficult—Python being correct. This is a convention mathematicians set centuries ago, and it still rules today. So get used to it."

**Audio Duration:** 22 seconds

***

### [SLIDE 6: Key Takeaway]

**Visual Main:**

```python
+  -  *  /
# Division always gives decimals
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 8–10 seconds

**Supporting Visuals (Static):**

- Four large operator icons in a row: `+  -  *  /` (each in its own box or badge).
- Small caption under `/` only: "Always decimal".
- Clean, high‑contrast background.

**Audio:**
"Four operators. Python writes math exactly how you'd expect—except division gives decimals. Always. Get used to it."

**Audio Duration:** 8 seconds

***

### Video 11 Summary

| **TOTAL** | |  **~110–120 seconds** |

***

## Video 12: Order of Operations (PEMDAS)

**Duration:** ~130–140 seconds
**Concept:** Python's strict order of operations and using parentheses

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Order of Operations
🔵 MAIN QUEST
```

**Slide Duration:** 12–15 seconds

**Supporting Visuals (Static):**

- Central object: Large rulebook, gavel, or scroll icon (strong metaphor).
- Around it: Faint "P E M D A S" letters in background as design element.
- Small Python snake character (holding gavel or pointer) integrated into corner.
- Minimal text overlay.

**Audio:**
"Pop quiz: What's 5 plus 3 times 2? If you said 16, you failed the Python test. If you said 11, you remember algebra class. If you said 'I hate math,' don't panic—programming uses the same math rules, you just get a computer to do the hard part. Let's fix this before it breaks your code."

**Audio Duration:** 15 seconds

***

### [SLIDE 2: The Problem]

**Visual Main:**

```python
result = 5 + 3 * 2
print(result)
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 14–18 seconds

**Supporting Visuals (Static):**

- **Minimal text, maximum visual clarity.**
- Left half: Expression "5 + 3 × 2" at top. Below: big red "16" with red X. Tiny label: "Left-to-Right".
- Right half: Same expression "5 + 3 × 2", with "3 × 2" circled/highlighted. Below: big green "11" with checkmark. Tiny label: "Python's Math".
- Small Python snake character on right (teacher pose).
- No long explanatory text on screen.

**Audio:**
"Five plus three times two. Your brain goes left-to-right: five plus three is eight, times two is sixteen. Wrong. Python gives you eleven. Why? Multiplication before addition. That's the rule."

**Audio Duration:** 14 seconds

***

### [SLIDE 3: PEMDAS – The Ancient Laws]

**Visual Main:**

```text
P - Parentheses ()
E - Exponents  **
M - Multiplication *
D - Division   /
A - Addition   +
S - Subtraction -
```

**Slide Duration:** 18–22 seconds

**Supporting Visuals (Static):**

- Large parchment-style scroll (central focal point).
- PEMDAS list written clearly on scroll.
- Vertical layout, `P` at top, `S` at bottom (priority hierarchy).
- Small Python snake at bottom of scroll, looking up respectfully.
- Minimal decoration.

**Audio:**
"PEMDAS. Parentheses, exponents, multiply and divide, add and subtract. Python follows this order religiously. Mathematicians set these rules centuries ago. Python just enforces them like a strict teacher who doesn't accept excuses."

**Audio Duration:** 18 seconds

***

### [SLIDE 4: Step-by-Step Breakdown]

**Visual Main:**

```python
result = 10 + 5 * 2
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- **Visual transformation sequence** (not text-heavy steps):
    - Top: Original expression "10 + 5 × 2" in large font.
    - Arrow down.
    - Middle: Same expression, but "5 × 2" circled/highlighted.
    - Arrow down to: "10 + 10".
    - Arrow down to final: "= 20" (big result, highlighted).
- Optional small numbered circles (1, 2, 3) to show sequence, minimal text.

**Audio:**
"Ten plus five times two. Python scans for multiplication. Five times two is ten. Now the expression is ten plus ten, which is twenty. The multiplication happened first even though it was written second. This is the law."

**Audio Duration:** 18 seconds

***

### [SLIDE 5: Parentheses Override Everything]

**Visual Main:**

```python
# Without parentheses
total = 10 + 5 * 2
print(total)  # 20

# With parentheses
total = (10 + 5) * 2
print(total)  # 30
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 20–24 seconds

**Supporting Visuals (Static):**

- Side‑by‑side comparison (two equal panels).
- Left panel: `10 + 5 * 2 = 20` (result large, clear).
- Right panel: `(10 + 5) * 2 = 30`. Parentheses thick and gold/bright.
- Small "VIP" badge or crown icon on the right expression.
- Minimal labels: "Standard" vs "With ( )".

**Audio:**
"Parentheses override all other rules. They're the VIP pass. Without them, ten plus five times two is twenty. WITH parentheses around ten plus five, that addition happens first—gives fifteen—then times two gives thirty. Parentheses let you control the order. Use them liberally. Python won't judge you."

**Audio Duration:** 22 seconds

***

### [SLIDE 6: Real Bug Example]

**Visual Main:**

```python
price = 20
discount = 5
quantity = 2

# Wrong
total = price - discount * quantity
print(total)  # 10

# Right
total = (price - discount) * quantity
print(total)  # 30
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 22–26 seconds

**Supporting Visuals (Static):**

- Top half: "Wrong" scenario. T-shirt icon with "$20". Math: "20 - 5 × 2 = 10". Confused/sad cash register face, red X.
- Bottom half: "Right" scenario. Same T-shirt. Math: "(20 - 5) × 2 = 30". Happy register face, green checkmark.
- Minimal labels: "Wrong" / "Right".

**Audio:**
"Shopping cart. Each item is twenty dollars, five-dollar discount per item, buying two. Without parentheses, Python multiplies five times two first—ten—then subtracts from twenty, giving ten total. That's wrong. With parentheses, twenty minus five is fifteen, times two is thirty. Parentheses save your wallet from bad math."

**Audio Duration:** 24 seconds

***

### [SLIDE 7: Key Takeaway]

**Visual Main:**

```python
# Python follows PEMDAS
# Multiplication before addition
# Parentheses override everything

# When in doubt: ( )
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 10–12 seconds

**Supporting Visuals (Static):**

- Large "( )" in center (power-up icon style, bright color).
- Small icons of `+ - * /` around it (secondary, muted color).
- Single caption line: "Follow PEMDAS. Use ( ) when in doubt."
- Clean background.

**Audio:**
"Python follows the order of operations. Multiplication and division before addition and subtraction. Use parentheses to make your intentions crystal clear. Your code should read like instructions, not like a riddle."

**Audio Duration:** 12 seconds

***

### Video 12 Summary

| **TOTAL** | | **~130–140 seconds** |

***

## Video 13: Special Operators

**Duration:** ~140–150 seconds
**Concept:** Floor division, modulo, and exponentiation

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Special Operators
🔵 MAIN QUEST
```

**Slide Duration:** 12–15 seconds

**Supporting Visuals (Static):**

- Central object: Three glowing symbols `//   %   **` (each in its own badge or orb).
- Each symbol in a different color circle (purple, orange, blue).
- Minimal dark background with subtle spotlight effect.

**Audio:**
"Beyond the basic four, Python has three operators that look weird but solve very real problems: floor division for whole numbers, modulo for leftovers, and exponentiation for powers. Once you learn them, you'll see them everywhere."

**Audio Duration:** 14 seconds

***

### [SLIDE 2: Floor Division – The Guillotine]

**Visual Main:**

```python
pizza_slices = 10
people = 3

slices_each = pizza_slices // people
print(slices_each)  # 3
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- Code block on left.
- Right: Top-down pizza with 10 slices. Three people, each clearly with 3 slices. One slice highlighted in center (remaining).
- Equation: "10 // 3 = 3" prominent.
- Small guillotine or "X" symbol next to "//" (static).
- Optional faded ".333…" crossed out.

**Audio:**
"Floor division uses two slashes. It divides, then CHOPS OFF the decimal. No rounding—just deletion. Ten slices among three people? Three each. It always rounds DOWN. The decimal lost a fair fight."

**Audio Duration:** 16 seconds

***

### [SLIDE 3: Modulo – The Leftover Finder]

**Visual Main:**

```python
pizza_slices = 10
people = 3

slices_each = pizza_slices // people  # 3
leftover = pizza_slices % people      # 1
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 14–18 seconds

**Supporting Visuals (Static):**

- Code on left.
- Right: Same pizza table, 3 people with 3 slices each. One slice **glowing** in center.
- Equation: "10 % 3 = 1" with small "remainder" label.
- Large "%" icon near highlighted slice.

**Audio:**
"Modulo uses the percent sign. It gives you the REMAINDER after division. Ten divided by three leaves three slices per person and ONE leftover. Floor division tells you the shares. Modulo tells you what's left over."

**Audio Duration:** 16 seconds

***

### [SLIDE 4: Modulo for Patterns]

**Visual Main:**

```python
# Every 5th customer gets a discount
customer = 4
print(customer % 5)  # 4

customer = 5
print(customer % 5)  # 0 — DISCOUNT!
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- Code on left.
- Right: **Visual loop cycle**:
    - Simple cycle: `1 → 2 → 3 → 4 → 0 →` looping back to `1`.
    - Each number inside a small circle or badge.
    - Star or "discount" icon on the `0` points in the cycle.
- No extra text.

**Audio:**
"Modulo creates cycles. Every fifth customer gets a discount? Use modulo five. Customers one through four give remainders one through four. Customer five? Remainder zero—discount time! The pattern repeats: 1, 2, 3, 4, 0, 1, 2, 3, 4, 0..."

**Audio Duration:** 18 seconds

***

### [SLIDE 5: Exponentiation – The Growth Operator]

**Visual Main:**

```python
print(2 ** 3)   # 8  (2*2*2)
print(5 ** 2)   # 25 (5*5)
print(10 ** 3)  # 1000

# Compound interest
savings = 100
rate = 1.05  # 5% per year
years = 3
final = savings * (rate ** years)
print(final)  # 115.76
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 24–28 seconds

**Supporting Visuals (Static):**

- Top: Three small visuals for `2 ** 3 = 8`, `5 ** 2 = 25`, `10 ** 3 = 1000` (simple cubes/grids).
- Bottom: Piggy bank centered with **4-point timeline**:
    - Year 0: "$100".
    - Year 1: "$105".
    - Year 2: "$110.25".
    - Year 3: "$115.76" (highlighted).
- Gently curving line above timeline, bending upward (exponential curve).
- Minimal text.

**Audio:**
"Exponentiation uses two stars. Two to the power of three is eight. Five squared is twenty-five. Ten cubed is one thousand. Use it for growth over time: one hundred bucks growing five percent per year becomes one hundred times 1.05 to the third power—about one-fifteen-seventy-six. Each year, the growth itself grows. That's compound growth. Exponential."

**Audio Duration:** 28 seconds

***

### [SLIDE 6: Why Not Use the Caret?]

**Visual Main:**

```python
# Math class:
# 2 ^ 3 = 8

# Python:
2 ** 3  # 8

# ^ is taken for bitwise XOR
# (obscure binary math you won't need for years)
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 14–18 seconds

**Supporting Visuals (Static):**

- Left box: "2^3 = 8" (label "Textbook Math").
- Right box: "2 ** 3" (label "Python Code").
- Caret "^" icon in middle with small "RESERVED" or no-entry icon.
- Minimal text.

**Audio:**
"In math class, you'd use a caret. Python already claimed that symbol for bitwise operations—obscure math you won't touch for years. So we're stuck with double-star. Welcome to programming: where symbols are limited and compromises are eternal."

**Audio Duration:** 16 seconds

***

### [SLIDE 7: Key Takeaway]

**Visual Main:**

```python
//  # Floor division (chops decimals)
%   # Modulo (leftovers)
**  # Exponent (powers)
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 10–12 seconds

**Supporting Visuals (Static):**

- Three icons in a row, each in its own badge/box:
    - `//` labeled "Whole".
    - `%` labeled "Leftover".
    - `**` labeled "Power".
- Minimal game-inventory framing.
- Clean background.

**Audio:**
"Floor division gives whole numbers. Modulo gives leftovers. Exponentiation gives powers. Weird symbols, but you'll use them constantly."

**Audio Duration:** 10 seconds

***

### Video 13 Summary
| **TOTAL** | | **~140–150 seconds** |

***

## Video 14: Patterns & Recap

**Duration:** ~100–110 seconds
**Concept:** Common formulas and wrapping up

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Patterns & Recap
🔵 MAIN QUEST
```

**Slide Duration:** 10–12 seconds

**Supporting Visuals (Static):**

- Central object: Clipboard or checklist icon with checkmarks.
- Small icons around it: percent symbol, average bar, price tag, bill/receipt.
- Clean background with subtle checkmark watermark.

**Audio:**
"You've learned all the pieces. Now here's the speed round: the most common calculation patterns you'll copy-paste for the rest of your life. Then we'll wrap up."

**Audio Duration:** 10 seconds

***

### [SLIDE 2: Percentage Pattern]

**Visual Main:**

```python
# Percentage
used = 45
total = 60
percent = (used / total) * 100
print(percent)  # 75.0
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 14–18 seconds

**Supporting Visuals (Static):**

- Code on left.
- Right: Phone storage bar (60 GB total, 45 GB filled). Label "75% used".
- Below bar (two lines): "45 ÷ 60 = 0.75" and "0.75 × 100 = 75%".

**Audio:**
"Percentage: divide current by total, times one hundred. Forty-five out of sixty is seventy-five percent. You'll write this formula constantly for progress bars, grades, storage, completion rates."

**Audio Duration:** 14 seconds

***

### [SLIDE 3: Average Pattern]

**Visual Main:**

```python
# Average
test1 = 85
test2 = 90
test3 = 78

total = test1 + test2 + test3
average = total / 3
print(average)  # 84.33
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- Code on left.
- Right: Three paper/test icons labeled "85", "90", "78".
- Below (two lines): "85 + 90 + 78 = 253" and "253 ÷ 3 = 84.33".
- Small "B+" badge near final average.

**Audio:**
"Average: add everything, divide by the count. Eighty, ninety, and seventy-eight total to two-fifty-three. Divide by three gives eighty-four point three three. Use this for grades, ratings, prices, any time you want the middle value."

**Audio Duration:** 16 seconds

***

### [SLIDE 4: Discount Pattern]

**Visual Main:**

```python
# Discount
price = 50
discount_pct = 20

discount_amount = price * (discount_pct / 100)
final_price = price - discount_amount
print(final_price)  # 40.0
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 14–18 seconds

**Supporting Visuals (Static):**

- Code on left.
- Right: Price tag showing "$50" crossed out and "$40" as new price.
- Below (two lines): "20% of 50 = 10" and "50 – 10 = 40".
- Clean, minimal retail style.

**Audio:**
"Discount: price times discount-over-one-hundred gives the discount amount. Subtract from original. Fifty bucks with twenty percent off means ten dollars off, leaving forty. Every sale uses this formula."

**Audio Duration:** 14 seconds

***

### [SLIDE 5: Bill Split Pattern]

**Visual Main:**

```python
# Bill split
bill = 100
people = 3

per_person = bill // people  # 33
leftover = bill % people     # 1

print("Each pays:", per_person)
print("Leftover:", leftover)
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- Code on left.
- Right: Top-down table with 3 person icons and a "$100 bill" icon in center.
- Below (two lines): "100 // 3 = 33 each" and "100 % 3 = 1 leftover".
- Small "$1" coin highlighted in center.

**Audio:**
"Splitting bills: use floor division for whole dollars per person, modulo for leftovers. One hundred divided by three is thirty-three each, with one dollar remaining. Use both operators together to handle real-world messiness."

**Audio Duration:** 16 seconds

***

### [SLIDE 6: What You've Learned]

**Visual Main:**

```python
# Operations Complete!
+  -  *  /  //  %  **
PEMDAS
( ) for control
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 12–15 seconds

**Supporting Visuals (Static):**

- "Operations Complete!" title with trophy icon.
- Row of all operators: `+ - * / // % **`.
- Small checklist: "Operators", "PEMDAS", "Parentheses".
- Progress bar: current section filled, next section greyed.

**Audio:**
"You can now add, subtract, multiply, divide, floor-divide, find remainders, and use powers. You know PEMDAS controls the order. You can use parentheses to override everything. That's real programming math."

**Audio Duration:** 14 seconds

***

### [SLIDE 7: What's Next]

**Visual Main:**

```python
# Coming up: Strings & Text

message = "  hello  "
clean = message.strip().upper()
# "HELLO"
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 12–15 seconds

**Supporting Visuals (Static):**

- Code on left.
- Right: Before/after transformation:
    - Left box: `"  hello  "` (spaces visible).
    - Arrow.
    - Right box: `"HELLO"` (uppercase, no spaces, highlighted).
- Icons next to arrow: scissors (for `.strip()`), up-arrow (for `.upper()`).

**Audio:**
"Next up: text. You've conquered numbers. Now you'll learn how to manipulate text—changing case, cleaning up spaces, replacing words, splitting and joining strings. Variables store data. Operations handle numbers. Methods control text. See you next time."

**Audio Duration:** 14 seconds

***

### Video 14 Summary

| **TOTAL** | | **~100–110 seconds** |

***

## 🌟 OPTIONAL PATH (Side Quests)

All optional videos display a small badge: `⭐ SIDE QUEST`.

***

## Video A: Writing Like a Pro

**Duration:** ~150 seconds
**Concept:** Assignment shortcuts and CONSTANTS convention

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Writing Like a Pro
⭐ SIDE QUEST
```

**Slide Duration:** 12–15 seconds

**Supporting Visuals (Static):**

- Central object: Clean code editor window or document icon.
- Small gold "SIDE QUEST" badge in corner.
- Minimal detail.

**Audio:**
"You know how to write code that works. Now let's learn how to write code that looks professional. Two techniques that separate beginners from pros: assignment shortcuts and the CONSTANTS convention."

**Audio Duration:** 14 seconds

***

### [SLIDE 2: The Repetitive Problem]

**Visual Main:**

```python
score = 100
score = score + 50
print(score)  # 150

followers = 500
followers = followers - 20
print(followers)  # 480
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- Code shown with repeated variable names highlighted.
- Small tired programmer avatar (half-empty coffee mug).
- Single caption: "Repeating names twice per line."

**Audio:**
"Look at this. Score equals score plus fifty. Followers equals followers minus twenty. We're typing the variable name TWICE every time. Once on the left, once on the right. It works, but it's repetitive. And professional programmers have a deep, personal hatred of repetition."

**Audio Duration:** 18 seconds

***

### [SLIDE 3: The Shortcut]

**Visual Main:**

```python
# Long way
score = score + 50

# Professional way
score += 50

# Same result, cleaner code
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- Side-by-side: top `score = score + 50` (faded, longer), bottom `score += 50` (bright, shorter).
- Character counter: "18 characters" vs "12 characters".
- Labels: "Beginner" vs "Pro".

**Audio:**
"Here's the shortcut: plus-equals. Instead of 'score equals score plus fifty,' write 'score plus-equals fifty.' Python grabs the current value, adds fifty, stores it back. One variable name instead of two. This is an assignment operator. Professional code uses these everywhere."

**Audio Duration:** 18 seconds

***

### [SLIDE 4: All the Shortcuts]

**Visual Main:**

```python
x = 10

x += 5   # x = x + 5
x -= 3   # x = x - 3
x *= 2   # x = x * 2
x /= 4   # x = x / 4
x //= 2  # x = x // 2
x **= 2  # x = x ** 2
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 18–22 seconds

**Supporting Visuals (Static):**

- Grid of six equal-sized boxes (2×3).
- Each box: one shortcut and label ("Add", "Subtract", "Multiply", etc.).
- Central note: "All mean: x = x (operator) value".

**Audio:**
"Every operator has a shortcut version. Plus-equals, minus-equals, times-equals, divide-equals, floor-divide-equals, power-equals. They all work the same: take the variable, do the math, store the result back. Less typing, cleaner code, happier you."

**Audio Duration:** 18 seconds

***

### [SLIDE 5: Real Example – Savings Tracker]

**Visual Main:**

```python
savings = 0

savings += 500  # Payday
savings -= 80   # Concert ticket
savings += 50   # Birthday money
savings -= 200  # Rent

print(savings)  # 270
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 20–24 seconds

**Supporting Visuals (Static):**

- Code on left.
- Right: Vertical list of transactions:
    - "+500 Payday" (money-bag icon).
    - "–80 Concert" (ticket icon).
    - "+50 Birthday" (gift icon).
    - "–200 Rent" (house icon).
    - Final "270" highlighted.
- Piggy bank icon next to final amount.
- Caption: "Life happens. Code stays clean."

**Audio:**
"Tracking changes over time becomes super readable. Savings starts at zero. Plus-equals five-hundred on payday. Minus-equals eighty for a concert. Plus-equals fifty for birthday money. Minus-equals two-hundred for rent. Final balance: two-seventy. It reads like a story of real life. And the code is clean doing it."

**Audio Duration:** 22 seconds

***

### [SLIDE 6: Enter CONSTANTS]

**Visual Main:**

```python
# Regular variables (can change)
health = 100
score = 0

# CONSTANTS (shouldn't change)
MAX_HEALTH = 100
GRAVITY = 9.8
TAX_RATE = 0.18
SPEED_LIMIT = 65
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 18–22 seconds

**Supporting Visuals (Static):**

- Two equal columns.
- Left ("Can change"): softer style (water/glass icon), listing `health`, `score`.
- Right ("Shouldn't change"): solid style (stone tablet/padlock icon), listing CONSTANTS.
- Visual contrast tells the story.

**Audio:**
"CONSTANTS are variables that shouldn't change during your program. Max health, gravity, tax rates, speed limits. Python doesn't enforce this—it's just a convention. If you write a variable in ALL CAPS with underscores, everyone knows: don't change this. It's a professional signal."

**Audio Duration:** 20 seconds

***

### [SLIDE 7: Why CONSTANTS Matter]

**Visual Main:**

```python
# Bad: magic numbers everywhere
total = price * 1.18
shipping = weight * 1.18

# Good: use CONSTANTS
TAX_RATE = 1.18
total = price * TAX_RATE
shipping = weight * TAX_RATE
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- Top ("Bad"): `1.18` circled multiple times (red), label "Magic number".
- Bottom ("Good"): `TAX_RATE = 1.18` defined once, reused below (green), label "Named constant".
- Caption: "Change once, updates everywhere."

**Audio:**
"Instead of mysterious numbers everywhere, define them once as CONSTANTS. If the tax rate changes, you update one line instead of hunting through your entire program. Your code becomes self-documenting. Other programmers—and future you—will thank you."

**Audio Duration:** 18 seconds

***

### [SLIDE 8: Pro Code Unlocked]

**Visual Main:**

```python
# You now write like this:
MAX_SCORE = 1000
score = 0

score += 50  # Clean shortcut
score += 100
score -= 25

# Instead of this:
score = score + 50
score = score + 100
score = score - 25
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 14–18 seconds

**Supporting Visuals (Static):**

- Two vertical code blocks side-by-side: "Before" (faded) vs "After" (bright).
- Gold "Pro Coder" badge next to "After".
- Checklist: "Cleaner", "Easier to read", "Less typing".

**Audio:**
"You've unlocked professional code style. Use assignment shortcuts to reduce repetition. Use CONSTANTS for values that don't change. Your code is now cleaner, more readable, and maintainable. You've leveled up."

**Audio Duration:** 14 seconds

***

### Video A Summary

| **TOTAL** | | **~150 seconds** |

***

## Video B: Helpful Python Functions

**Duration:** ~120 seconds
**Concept:** Built-in functions for working with numbers

***

### [SLIDE 1: Title Screen]

**Visual Main:**

```text
Helpful Python Functions
⭐ SIDE QUEST
```

**Slide Duration:** 10–12 seconds

**Supporting Visuals (Static):**

- Central toolbox icon with labels `type`, `abs`, `min`, `max`, `pow` on tools.
- "SIDE QUEST" badge clearly visible.
- Minimal background.

**Audio:**
"Python has built-in functions that make working with numbers easier. Think of them as power tools in your programming toolbox. Let's look at five you'll actually use."

**Audio Duration:** 10 seconds

***

### [SLIDE 2: type() – The Detective]

**Visual Main:**

```python
money = 100
print(type(money))  # <class 'int'>

money = money / 2
print(type(money))  # <class 'float'>

name = "Player"
print(type(name))  # <class 'str'>
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 16–20 seconds

**Supporting Visuals (Static):**

- Three small boxes:
    - `money = 100 → int`.
    - `money = 50.0 → float`.
    - `name = "Player" → str`.
- Detective icon with magnifying glass in corner.
- Minimal text.

**Audio:**
"`type()` is your detective function. Not sure what type a variable is? Ask it. Integer, float, string—it'll tell you. Super useful when division sneaks a float into your code and you're suddenly seeing decimals."

**Audio Duration:** 14 seconds

***

### [SLIDE 3: abs() – Absolute Value]

**Visual Main:**

```python
# Distance without direction
print(abs(-15))  # 15
print(abs(15))   # 15

# How far from target?
current_temp = 18
target_temp = 22
difference = abs(current_temp - target_temp)
print(difference)  # 4 degrees off
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 18–22 seconds

**Supporting Visuals (Static):**

- Top: Number line with –15 and +15 equally distant from 0, label "15".
- Bottom: Thermometer with 18° vs 22°, difference labeled "4°".
- Minimal text.

**Audio:**
"`abs()` gives you absolute value—distance without caring about direction. Negative fifteen and positive fifteen are both fifteen away from zero. Useful for finding differences, distances, and gaps."

**Audio Duration:** 14 seconds

***

### [SLIDE 4: min() and max() – Finding Extremes]

**Visual Main:**

```python
# Find the smallest
print(min(5, 2, 9, 1))  # 1

# Find the largest
print(max(5, 2, 9, 1))  # 9

# Cap damage at maximum
damage = 150
MAX_DAMAGE = 100
actual_damage = min(damage, MAX_DAMAGE)
print(actual_damage)  # 100

damage = 50
actual_damage = min(damage, MAX_DAMAGE)
print(actual_damage)  # 50
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 24–28 seconds

**Supporting Visuals (Static):**

- Top: Bar chart with bars 5, 2, 9, 1. Arrows to smallest (1) and largest (9).
- Bottom: Two damage scenarios:
    - "damage = 150, MAX_DAMAGE = 100 → actual = 100".
    - "damage = 50, MAX_DAMAGE = 100 → actual = 50".
- Minimal text.

**Audio:**
"`min()` finds the smallest value, `max()` finds the largest. Great for capping values, finding best scores, or picking extremes from a list. If damage is one-fifty but MAX_DAMAGE is one hundred, `min(damage, MAX_DAMAGE)` gives you one hundred. If damage is fifty, `min(damage, MAX_DAMAGE)` gives fifty—because fifty is smaller than one hundred. `min()` returns the smallest, period."

**Audio Duration:** 24 seconds

***

### [SLIDE 5: pow() – Alternative to **]

**Visual Main:**

```python
# Two ways to do powers
print(2 ** 3)      # 8
print(pow(2, 3))   # 8

# They're the same
```

PRODUCE OUTPUT: TRUE

**Slide Duration:** 12–15 seconds

**Supporting Visuals (Static):**

- Split: left "2 ** 3 = 8", right "pow(2, 3) = 8".
- Equals sign in middle (equivalence).
- Caption: "Same result. Most use **".

**Audio:**
"`pow()` is an alternative to double-star for exponents. Two to the third power? You can write `2 ** 3` or `pow(2, 3)`. They're identical. Most Python programmers use double-star because it's shorter, but you'll see `pow()` sometimes."

**Audio Duration:** 14 seconds

***

### [SLIDE 6: Quick Reference]

**Visual Main:**

```python
type(x)     # What type is this?
abs(x)      # Distance from zero
min(a,b,c)  # Find smallest
max(a,b,c)  # Find largest
pow(x,y)    # x to the power of y
```

PRODUCE OUTPUT: FALSE

**Slide Duration:** 12–15 seconds

**Supporting Visuals (Static):**

- Five icons in a row (each in its own badge/box), labeled:
    - `type`, `abs`, `min`, `max`, `pow`.
- One-line description under each.
- Caption: "Your number toolkit".

**Audio:**
"These five functions are your number toolkit. type() identifies what you have. abs() finds distances. min() and max() find extremes. pow() calculates powers. You'll see these often, and knowing them will save you time."

**Audio Duration:** 12 seconds

***

### Video B Summary

| **TOTAL** | | **~120 seconds** |

***

## Arc 3 Complete Summary

### Required Path (Main Quest) 🔵

| **REQUIRED TOTAL** | | **~480–520 seconds (8–8.7 min)** |

### Optional Path (Side Quests) ⭐

| Video | Title | Duration | Slides |
|-------|-------|----------|--------|
| A | Writing Like a Pro | 150s | 8 |
| B | Helpful Python Functions | 120s | 6 |
| **OPTIONAL TOTAL** | | **~270 seconds (4.5 min)** | **14 slides** |

### Arc 3 Grand Total

| Category | Duration | Slides |
|----------|----------|--------|
| **Required Videos** | ~480–520 seconds (8–8.7 min) | 27 |
| **Optional Videos** | ~270 seconds (4.5 min) | 14 |
| **COMPLETE ARC 3** | **~750–790 seconds (12.5–13.2 min)** | **41 slides** |

***

_End of Arc 3 static visual specification with comprehensive timing information._

<div align="center">⁂</div>
