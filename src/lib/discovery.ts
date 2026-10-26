import { createDiscoveryRepository } from './discovery-repository';
import { getSupabase } from './supabase';
import { withDeadline } from './capture-network';
import type { DiscoveryRequest } from '../../supabase/functions/_shared/discovery-contract';
export type { DiscoveryItem } from './discovery-repository';
export type { DiscoveryRequest } from '../../supabase/functions/_shared/discovery-contract';
export const nextDiscovery = (request: DiscoveryRequest, signal?: AbortSignal) => withDeadline(child => createDiscoveryRepository(getSupabase()).next(request, child), 20000, signal);
export const dismissDiscovery = (userId: string, requestId: string) => withDeadline(() => createDiscoveryRepository(getSupabase()).dismiss(userId, requestId), 15000);
