import { Event, Filter, SimplePool, matchFilters } from 'nostr-tools';
import { create } from 'zustand';

import { areAllFiltersEqual, filterUniqueFilters, filterUniqueRelays } from '../utils';

import { Config } from '../types';

interface State {
  _pool: SimplePool;
  _events: Event[];
  _subscriptionQueue: Config[];
  _isBatching: boolean;
  _subList: [string, Filter[]][];
}

interface Actions {
  _unSub: (subId: string) => void;
  _purgeEvents: (subId: string) => void;
  _setIsBatching: (isBatching: boolean) => void;
  _clearQueue: () => void;
  _addEvent: (event: Event) => void;
  _handlePoolSub: (config: Config) => void;
  _processQueue: () => void;
  _addToQueue: (config: Config) => void;
  _addToSubList: (subId: string, filters: Filter[]) => void;
  _removeFromSubList: (subId: string) => void;
  _handleNewSub: (config: Config, subId: string) => void;
}

export const useNostrStore = create<State & Actions>()((set, get) => ({
  _pool: new SimplePool(),
  _events: [],
  _subscriptionQueue: [],
  _subList: [],
  _isBatching: false,
  _unSub: (subId) => {
    get()._purgeEvents(subId);
    get()._removeFromSubList(subId);
  },
  _purgeEvents: (subId) => {
    const subList = get()._subList;
    const purgingSub = subList.find((sub) => sub[0] === subId);
    if (!purgingSub) return;

    const purgingFilters = purgingSub[1];
    const otherSubsWithSameFilters = subList.filter((otherSub) => {
      if (otherSub[0] === subId) return false;

      const otherSubFilters = otherSub[1];
      return areAllFiltersEqual(purgingFilters, otherSubFilters);
    });
    if (otherSubsWithSameFilters.length > 0) return;

    set((store) => ({
      _events: store._events.filter((event) => !matchFilters(purgingFilters, event)),
    }));
  },
  _setIsBatching: (isBatching) => set({ _isBatching: isBatching }),
  _addToQueue: ({ filters, relays }) => {
    set((store) => ({ _subscriptionQueue: [...store._subscriptionQueue, { filters, relays }] }));
  },
  _clearQueue: () => set({ _subscriptionQueue: [] }),
  _addEvent: (event) => set((store) => ({ _events: [...store._events, event] })),
  _addToSubList: (subId, filters) => {
    set((store) => ({ _subList: [...store._subList, [subId, filters]] }));
  },
  _removeFromSubList: (subId) => {
    set((store) => ({ _subList: store._subList.filter((sub) => sub[0] !== subId) }));
  },
  _handlePoolSub: ({ filters, relays }) => {
    const pool = get()._pool;
    const sub = pool.sub(filterUniqueRelays(relays), filterUniqueFilters(filters));
    sub.on('event', (event: Event) => get()._addEvent(event));
    sub.on('eose', () => sub.unsub());
  },
  _processQueue: () => {
    const subscriptionQueue = get()._subscriptionQueue;
    if (subscriptionQueue.length > 0) {
      const flattenSub = subscriptionQueue.reduce<Config>(
        (acc, curr) => {
          return {
            relays: [...acc.relays, ...curr.relays],
            filters: [...acc.filters, ...curr.filters],
          };
        },
        { relays: [], filters: [] }
      );
      get()._handlePoolSub({ filters: flattenSub.filters, relays: flattenSub.relays });
      get()._clearQueue();
      get()._setIsBatching(false);
    }
  },
  _handleNewSub: ({ filters, relays, options }, subId) => {
    get()._addToSubList(subId, filters);
    if (options?.force) {
      get()._handlePoolSub({ filters, relays });
      return;
    }
    get()._addToQueue({ filters, relays });
    if (!get()._isBatching) {
      get()._setIsBatching(true);
      setTimeout(get()._processQueue, options?.batchingInterval || 500);
    }
  },
}));
