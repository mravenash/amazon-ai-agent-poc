import { useEffect, useMemo, useState } from 'react';
import { Badge, Box, SpaceBetween } from '@cloudscape-design/components';
import { useChatStore } from '../store/chatStore';

export function StatusBar() {
  const { tokenCount, streamStartMs, streamEndMs, reconnecting } = useChatStore();
  const [backend, setBackend] = useState<'bedrock' | 'mock' | 'unknown'>('unknown');

  useEffect(() => {
    fetch('http://localhost:8787/api/status')
      .then(r => r.json())
      .then(d => setBackend(d.backend))
      .catch(() => setBackend('unknown'));
  }, []);

  const elapsedMs = (streamEndMs ?? Date.now()) - (streamStartMs ?? Date.now());
  const rate = useMemo(() => {
    if (!streamStartMs) return 0;
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    return +(tokenCount / seconds).toFixed(1);
  }, [tokenCount, streamStartMs, streamEndMs, elapsedMs]);

  return (
    <SpaceBetween size="xxs" direction="horizontal">
      <Badge color={backend === 'bedrock' ? 'blue' : backend === 'mock' ? 'grey' : 'red'}>
        {backend}
      </Badge>
      <Box variant="p">Tokens: {tokenCount}</Box>
      <Box variant="p">Elapsed: {Math.max(0, Math.floor(elapsedMs))}ms</Box>
      <Box variant="p">Rate: {rate}/s</Box>
      {reconnecting && reconnecting.inProgress && (
        <Box variant="p">Reconnecting… attempt {reconnecting.attempt}{reconnecting.nextDelayMs ? ` (in ${Math.ceil((reconnecting.nextDelayMs || 0)/100)/10}s)` : ''}</Box>
      )}
    </SpaceBetween>
  );
}
