/*
  Author: Runor Ewhro
  description: defines the canonical average-damage primitive in TypeScript and
               in the WGSL prefix shared by every generated kernel.
*/

export function optimizerAverageDamage(normal: number, critRate: number, critDamage: number): number {
  const rate = Math.max(0, Math.min(1, critRate))
  return normal * (1 + rate * (critDamage - 1))
}

export const OPTIMIZER_DAMAGE_SPEC_WGSL = /* wgsl */ `
fn optimizerAverageDamage(normal: f32, critRate: f32, critDamage: f32) -> f32 {
    let rate = clamp(critRate, 0.0, 1.0);
    return normal * (1.0 + rate * (critDamage - 1.0));
}
`
