import type { Rules, Team } from "./types";

export const MISTO_E_BELLO: Rules = {
  setsToWin: 3,
  pointsPerSet: 25,
  pointsLastSet: 15,
  minLead: 2,
  timeoutsPerSet: 2,
  timeoutSeconds: 30,
};

export function targetFor(rules: Rules, setIndex: number): number {
  const decidingSet = rules.setsToWin * 2 - 2;
  return setIndex === decidingSet ? rules.pointsLastSet : rules.pointsPerSet;
}

export function setWinner(home: number, guest: number, target: number, minLead: number): Team | null {
  if (Math.max(home, guest) < target || Math.abs(home - guest) < minLead) return null;
  return home > guest ? "home" : "guest";
}

export const otherTeam = (team: Team): Team => (team === "home" ? "guest" : "home");
