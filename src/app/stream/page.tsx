'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Use a dynamic import if needed, or check if this works directly in client component
// For Next.js App Router, dynamic import is usually better for heavy client-side libraries
import dynamic from 'next/dynamic';

const IVSBroadcastClient = dynamic(
    () => import('amazon-ivs-web-broadcast').then((mod) => mod.default),
    { ssr: false }
);

export default function StreamPage() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [client, setClient] = useState<any>(null);
    const [isLive, setIsLive] = useState(false);
    const [permissionsGranted, setPermissionsGranted] = useState(false);

    useEffect(() => {
        const init = async () => {
            try {
                // Get stream first - this prompts permission
                // We KEEP this stream to pass to the SDK
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true,
                });
                
                setPermissionsGranted(true);

                const IVSBroadcastClientModule = await import('amazon-ivs-web-broadcast');
                const clientInstance = IVSBroadcastClientModule.create({
                    streamConfig: IVSBroadcastClientModule.BASIC_LANDSCAPE,
                    ingestEndpoint: process.env.NEXT_PUBLIC_AWS_IVS_INGEST_ENDPOINT,
                });

                setClient(clientInstance);

                // Attach preview to canvas
                if (canvasRef.current) {
                    clientInstance.attachPreview(canvasRef.current);
                }

                // Add devices using the stream we already have
                await clientInstance.addVideoInputDevice(stream, 'camera1', { index: 0 });
                await clientInstance.addAudioInputDevice(stream, 'mic1');

            } catch (err) {
                console.error('Error initializing stream:', err);
            }
        };

        if (typeof window !== 'undefined') {
            init();
        }
    }, []);

    const startBroadcast = async () => {
        if (!client) return;

        try {
            const streamKey = process.env.NEXT_PUBLIC_AWS_IVS_STREAM_KEY;
            if (!streamKey) {
                console.error('Missing stream key');
                return;
            }

            await client.startBroadcast(streamKey);
            setIsLive(true);

            // Update Supabase
            // Generate or retrieve a persistent ID for this client
            let userId = localStorage.getItem('stream_user_id');
            if (!userId) {
                userId = crypto.randomUUID();
                localStorage.setItem('stream_user_id', userId);
            } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
                 // Check if the existing ID is NOT a valid UUID (e.g., from old logic)
                 // If invalid, generate a new one.
                 userId = crypto.randomUUID();
                 localStorage.setItem('stream_user_id', userId);
            }

            const { error } = await supabase
                .from('streams')
                .upsert({ 
                    id: userId,
                    status: 'live',
                    playback_url: process.env.NEXT_PUBLIC_AWS_IVS_PLAYBACK_URL
                });

            if (error) {
                console.error('Supabase Error updating status:', error);
                console.error('Error details:', error.message, error.details, error.hint);
            }

            if (error) console.error('Error updating status:', error);

        } catch (err) {
            console.error('Error starting broadcast:', err);
        }
    };

    const stopBroadcast = async () => {
        if (!client) return;
        try {
            await client.stopBroadcast();
            setIsLive(false);
            // Update Supabase
            const userId = localStorage.getItem('stream_user_id');
            if (userId) {
                const { error } = await supabase
                    .from('streams')
                    .update({ status: 'offline' })
                    .eq('id', userId);
                    
                if (error) console.error('Error updating status:', error);
            }

        } catch (err) {
            console.error('Error stopping broadcast:', err);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-4">
            <h1 className="text-2xl font-bold mb-4">Mobile Streamer</h1>
            
            <div className="relative w-full max-w-md aspect-video bg-gray-900 rounded-lg overflow-hidden mb-6">
                <canvas
                    ref={canvasRef}
                    className="w-full h-full object-cover"
                />
                {isLive && (
                    <div className="absolute top-2 right-2 bg-red-600 px-2 py-1 rounded text-xs font-bold uppercase animate-pulse">
                        LIVE
                    </div>
                )}
            </div>

            <div className="flex gap-4">
                {!isLive ? (
                    <Button 
                        onClick={startBroadcast} 
                        disabled={!client || !permissionsGranted}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-full text-lg w-full sm:w-auto"
                    >
                        Go Live
                    </Button>
                ) : (
                    <Button 
                        onClick={stopBroadcast} 
                        variant="destructive"
                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg w-full sm:w-auto"
                    >
                        End Stream
                    </Button>
                )}
            </div>
        </div>
    );
}
