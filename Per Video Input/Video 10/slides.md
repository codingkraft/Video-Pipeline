# Working with Multiple Variables

## Slide 1: Title Screen
**Visual:** "Video 10: Working with Multiple Variables"
**Audio:** One variable is lonely. Real programs juggle lots of variables at once: username, score, level, settings, inventory—everything. Let's build a character profile to see how variables work together.
**Duration:** 14s

---

## Slide 2: Character Profile (Multiple Types)
**Visual:** ```python
hero_name = "Swift_Shadow_Assassin"
hero_level = 1
hero_speed = 0.1
hero_weapon = "Rusty Spoon"
runs_from_combat = True
```
**Audio:** Meet our hero. Great name… questionable stats. Notice we're using different types: text for names, numbers for stats, and True/False for behavior. That True/False type is called a Boolean—basically an on/off switch.
**Duration:** 20s

---

## Slide 3: Backpack Pockets (Independence)
**Visual:** Backpack pockets labeled with each variable
**Audio:** Think of each variable like its own pocket. Weapon pocket, speed pocket, name pocket. Changing one pocket doesn't magically change the others.
**Duration:** 14s

---

## Slide 4: Printing Multiple Values (Comma Method)
**Visual:** ```python
print("Hero:", hero_name)
print("Level:", hero_level)
print("Weapon:", hero_weapon)
print("Runs from combat:", runs_from_combat)
```
**Audio:** Use commas in print() to show labels and values together. print() handles spacing for you. Clean, readable output.
**Duration:** 16s

---

## Slide 5: Combining Strings (Superglue)
**Visual:** ```python
title = "The Legendary"
full_name = hero_name + " " + title
print(full_name)
```
**Audio:** You can glue strings together with plus. Some people call this concatenation, but think of it as superglue for text. Here's how it works: Python takes hero_name—that's 'Swift_Shadow_Assassin'—adds a space, then adds 'The Legendary'. They stick together into one long string. Now our cowardly hero has a properly formatted title.
**Duration:** 20s

---

## Slide 6: Variables Stay Independent
**Visual:** ```python
hero_speed = 0.1
enemy_speed = 50.0

hero_speed = 0.05
print(enemy_speed)  # still 50.0
```
**Audio:** Changing hero_speed doesn't change enemy_speed. Variables don't affect each other unless you explicitly connect them. They're separate containers.
**Duration:** 14s

---

## Slide 7: Stay Organized (Prefixes)
**Visual:** ```python
player_hp = 50
player_xp = 500

enemy_hp = 500
enemy_xp = 1000
```
**Audio:** Organization matters. Prefixes like player_ and enemy_ keep your variables from turning into a confusing soup. The player has 50 HP, the enemy has 500. Accidentally swapping those would make for a very short, very one-sided game.
**Duration:** 14s

---

## Slide 8: Key Takeaway
**Visual:** Full character sheet recap
**Audio:** Real programs coordinate many variables of different types. Name them clearly, keep them organized, and use them together to describe bigger systems.
**Duration:** 10s
