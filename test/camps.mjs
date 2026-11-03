/**
 * Relief camp ranking — which supply truck leaves next.
 *
 * The thing this must never do is let a small loud camp outrank a large
 * quiet one. Kerala's students ranked camps by hand and got that right
 * because a person can see the population column; a weighting scheme can
 * silently invert it, and nobody notices until the truck is at the wrong
 * gate. Population dominance is the first thing asserted below.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { rankCamps, campsHeadline, supplierFor } = await loadFromSrc("lib/camps.ts", { bundle: true });
const { check, report } = harness();

const camp = (id, name, place, people, needs, team = null) => ({ id, name, place, people, team, needs });
const need = (item, needed, received = 0, urgency = "normal") => ({ item, needed, received, urgency });

console.log("POPULATION IS THE DOMINANT TERM");
{
  const ranked = rankCamps([
    camp(1, "Small School", "Kangra", 20, [need("water", 100, 0, "critical")]),
    camp(2, "Big Hall", "Dhubri", 2000, [need("water", 100, 0, "urgent")]),
  ]);
  check(
    "2,000 people at urgent outranks 20 people at critical",
    ranked[0].id === 2,
    `top was ${ranked[0].name}`,
  );
  check("both still listed", ranked.length === 2);
}

console.log("\nURGENCY MODULATES, WITHIN THE SAME POPULATION");
{
  const ranked = rankCamps([
    camp(1, "A", "P", 500, [need("water", 50, 0, "normal")]),
    camp(2, "B", "P", 500, [need("water", 50, 0, "critical")]),
  ]);
  check("same size, critical wins", ranked[0].id === 2, ranked[0].name);
}

console.log("\nMET NEEDS DROP OUT ENTIRELY");
{
  const ranked = rankCamps([
    camp(1, "Stocked", "P", 900, [need("food", 100, 100), need("water", 50, 50)]),
    camp(2, "Short", "Q", 100, [need("food", 100, 10)]),
  ]);
  check("a fully supplied camp is not on a supply list", ranked.length === 1, String(ranked.length));
  check("the one that needs something is", ranked[0].id === 2);
  check("partial delivery counts — short is what remains", ranked[0].worst.short === 90, String(ranked[0].worst.short));
}

console.log("\nWATER AND MEDICAL OUTRANK BEDDING AT EQUAL URGENCY");
{
  const ranked = rankCamps([camp(1, "A", "P", 300, [
    need("bedding", 100, 0, "urgent"),
    need("water", 100, 0, "urgent"),
  ])]);
  check("water sorts above bedding within a camp", ranked[0].worst.item === "water", ranked[0].worst.item);
}

console.log("\nEVERY ROW EXPLAINS ITSELF");
{
  const ranked = rankCamps([camp(1, "Govt School", "Dhubri", 450, [need("water", 200, 20, "critical")], "Red Cross")]);
  const why = ranked[0].why;
  check("names the camp and place", /Govt School/.test(why) && /Dhubri/.test(why), why);
  check("names the population", /450/.test(why), why);
  check("names the shortfall, not the original ask", /180/.test(why), why);
  check("names who is running it", /Red Cross/.test(why), why);
  check("no markup — this gets spoken", !/[*_<>{}#]/.test(why), why);
}
{
  const ranked = rankCamps([camp(1, "Unclaimed", "X", 50, [need("food", 10)])]);
  check(
    "a camp with no organisation says so rather than leaving a blank",
    /nobody has taken charge/i.test(ranked[0].why),
    ranked[0].why,
  );
}

console.log("\nHEADLINE");
{
  const ranked = rankCamps([
    camp(1, "A", "Dhubri", 800, [need("water", 300, 0, "critical")]),
    camp(2, "B", "Barpeta", 200, [need("food", 100)]),
  ]);
  const h = campsHeadline(ranked);
  check("counts camps and people", /2 camps/.test(h) && /1,000/.test(h), h);
  check("names the worst", /A/.test(h) && /Dhubri/.test(h), h);
  check("speakable", !/[*_<>{}#]/.test(h), h);
}
{
  // The good-news case and the broken-lookup case look identical if this
  // returns nothing, which is why it must say something.
  check(
    "all-stocked says so instead of going silent",
    /No camp has an outstanding need/.test(campsHeadline([])),
    campsHeadline([]),
  );
}

console.log("\nSUPPLIER MATCHING — never name a team that cannot help");
const stock = (team, place, boats, medicalKits, foodPackets) => ({ team, place, boats, medicalKits, foodPackets });
{
  const stocks = [stock("A", "P", 0, 0, 500), stock("B", "Q", 4, 30, 0)];
  check("food goes to whoever holds food", supplierFor("food", stocks).team === "A");
  check("medical goes to whoever holds medical", supplierFor("medical", stocks).team === "B");
  check("most stock wins", supplierFor("boats", stocks).team === "B");
}
{
  const stocks = [stock("A", "P", 0, 0, 0)];
  check(
    "nobody holding it returns null, not a useless nearest guess",
    supplierFor("medical", stocks) === null,
  );
  check(
    "an untracked item returns null rather than pretending",
    supplierFor("bedding", [stock("A", "P", 9, 9, 9)]) === null,
  );
}

console.log("\nDEGENERATE INPUT");
check("no camps at all", rankCamps([]).length === 0);
check("a camp with no needs", rankCamps([camp(1, "A", "P", 10, [])]).length === 0);
check(
  "zero population does not divide by zero or vanish",
  rankCamps([camp(1, "A", "P", 0, [need("food", 5)])]).length === 1,
);

report();
