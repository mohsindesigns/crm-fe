'use client';

import { useParams } from 'next/navigation';
import MessagesApp from '@/components/messages/MessagesApp';

export default function MessagesRoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  return <MessagesApp roomId={roomId} />;
}
