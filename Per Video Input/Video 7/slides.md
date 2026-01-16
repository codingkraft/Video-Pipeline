# Changing Stored Values

## Slide 1: Title Screen
**Visual:** "Video 7: Changing Stored Values"
**Audio:** Real data changes constantly. Your score changes, your battery changes, your mood changes after 'one more video.' Variables aren't permanent—you can update them whenever you want.
**Duration:** 10s

---

## Slide 2: The Replacement Rule
**Visual:** ```python
score = 100
score = 200  # What happened to 100?
```
**Audio:** Key rule: when you assign a new value to a variable, the old value is replaced. Not saved. Not archived. Gone. Variables don't keep memories—ironic, I know.
**Duration:** 15s

---

## Slide 3: Real-World Analogy — Whiteboard
**Visual:** Whiteboard: "Study Python" crossed out → "Watch Cat Videos"
**Audio:** Think of a variable like a whiteboard. You write something with determination. Then reality hits. You erase it and write something new. Same whiteboard, different content. Variables work the same way.
**Duration:** 14s

---

## Slide 4: Step-by-Step Update (Tabs)
**Visual:** ```python
youtube_tabs = 1
print(youtube_tabs)

youtube_tabs = 5
print(youtube_tabs)

youtube_tabs = 23
print(youtube_tabs)
```
**Audio:** Let's track something we all understand: YouTube tabs. Start with 1 tab open—you're being responsible. Print shows 1. Then 'just one more video' happens. We assign youtube_tabs = 5. That overwrites the 1—it's gone. Print shows 5. An hour later? We assign youtube_tabs = 23 and your browser is crying for mercy. The 5 gets replaced. Print shows 23. Same variable, but each new assignment completely overwrites what was there before. Python doesn't judge your tab addiction.
**Duration:** 20s

---

## Slide 5: Using the Current Value
**Visual:** ```python
followers = 100
print(followers)  # 100

followers = followers + 50
print(followers)  # 150
```
**Audio:** Here's where it gets powerful: you can use a variable's current value to calculate its new value. Followers starts at 100. Then we say: followers equals followers plus 50. Python reads the RIGHT side first—looks up followers, sees 100, adds 50, gets 150. Then it stores that 150 back into followers. The old 100? Replaced. Now when we print, we see 150. It's the same variable, just updated with math.
**Duration:** 22s

---

## Slide 6: XP Pattern (Games)
**Visual:** ```python
xp = 0
# You defeated an enemy!
xp = xp + 10
print(xp)  # 10

# You defeated another enemy!
xp = xp + 10
print(xp)  # 20
```
**Audio:** This pattern is everywhere in games. You start with 0 XP. You defeat an enemy. We do: xp equals xp plus 10. Python evaluates the right side first—0 plus 10 equals 10—then shoves that back into xp. Print shows 10. Defeat another enemy, same code runs again. Python reads xp—now 10—adds 10, gets 20, stores it back. The 10 gets overwritten. We're not getting a new XP bar each time; the old value just keeps getting replaced.
**Duration:** 24s

---

## Slide 7: Phone Battery
**Visual:** Battery 100% → 50% → 20% → 1%
**Audio:** Your phone battery is basically a variable. Same battery icon, different value inside—and somehow it always drops faster when you need it most.
**Duration:** 10s

---

## Slide 8: Key Takeaway
**Visual:** ```python
x = 5
x = 10      # 5 is gone
x = x + 1   # Now 11
```
**Audio:** Variables update constantly. New values replace old ones. And you can use the current value to compute the next value. That's how programs track a changing world.
**Duration:** 10s
