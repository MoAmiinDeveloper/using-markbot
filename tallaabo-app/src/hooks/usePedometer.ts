import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type PedometerStatus = 'idle' | 'connecting' | 'ready' | 'unavailable' | 'denied';

/**
 * Optional hardware step counter.
 * iOS: steps since midnight (Core Motion history) plus live updates.
 * Android: the OS only exposes live updates, so the count starts when you connect.
 */
export function usePedometer() {
  const [status, setStatus] = useState<PedometerStatus>('idle');
  const [steps, setSteps] = useState(0);
  const subscription = useRef<{ remove: () => void } | null>(null);

  useEffect(() => () => subscription.current?.remove(), []);

  const connect = useCallback(async () => {
    setStatus('connecting');
    try {
      if (!(await Pedometer.isAvailableAsync())) return setStatus('unavailable');
      const permission = await Pedometer.requestPermissionsAsync();
      if (!permission.granted) return setStatus('denied');

      let base = 0;
      if (Platform.OS === 'ios') {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        base = (await Pedometer.getStepCountAsync(midnight, new Date())).steps;
      }
      setSteps(base);
      subscription.current?.remove();
      subscription.current = Pedometer.watchStepCount((result) => setSteps(base + result.steps));
      setStatus('ready');
    } catch (e) {
      console.warn('Pedometer failed', e);
      setStatus('unavailable');
    }
  }, []);

  return { status, steps, connect, sinceMidnight: Platform.OS === 'ios' };
}
