import type { Frame,Settings } from './protocol';

/** Display bands are demonstration settings, not physiological fatigue classes or %MVC. */
export function biofeedback(rms:number|null,settings:Settings):Pick<Frame,'activation_pct'|'activation_level'|'target_zone'> {
  if(rms===null||!Number.isFinite(rms)||!settings.reference_rms)return {activation_pct:null,activation_level:'unavailable',target_zone:'unavailable'};
  const pct=Math.max(0,100*rms/settings.reference_rms);
  return {activation_pct:pct,activation_level:pct<30?'low':pct<70?'medium':'high',target_zone:pct<(settings.zone_low_pct??40)?'below':pct>(settings.zone_high_pct??70)?'above':'inside'};
}
