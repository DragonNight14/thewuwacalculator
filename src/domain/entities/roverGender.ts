/*
  Author: Runor Ewhro
  description: identifies the paired rover forms used by the app-wide gender preference.
*/

export type RoverGender = 'both' | 'male' | 'female'
export const ROVER_GENDER_OPTIONS: readonly RoverGender[] = ['both', 'male', 'female']

export const ROVER_PAIRS = [
  { male: '1501', female: '1502', attribute: 'spectro' },
  { male: '1604', female: '1605', attribute: 'havoc' },
  { male: '1309', female: '1310', attribute: 'electro' },
  { male: '1406', female: '1408', attribute: 'aero' },
] as const

const ROVER_PAIR_BY_ID = new Map<string, (typeof ROVER_PAIRS)[number]>(
  ROVER_PAIRS.flatMap((pair) => [[pair.male, pair], [pair.female, pair]] as const),
)

export function roverPairFor(id: string) {
  return ROVER_PAIR_BY_ID.get(id) ?? null
}

export function roverIdForGender(id: string, gender: RoverGender): string {
  const pair = roverPairFor(id)
  return pair && gender !== 'both' ? pair[gender] : id
}

export function roverIsVisible(id: string, gender: RoverGender): boolean {
  return roverIdForGender(id, gender) === id
}
