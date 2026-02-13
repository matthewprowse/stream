'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Use a dynamic import if needed, or check if this works directly in client component
// For Next.js App Router, dynamic import is usually better for heavy client-side libraries
// import dynamic from 'next/dynamic';

// const IVSBroadcastClient = dynamic(
//    () => import('amazon-ivs-web-broadcast').then((mod) => mod.default as any),
//    { ssr: false }
// );

export default function StreamPage() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [client, setClient] = useState<any>(null);
    const [isLive, setIsLive] = useState(false);
    const [permissionsGranted, setPermissionsGranted] = useState(false);
    const [hasJoined, setHasJoined] = useState(false);

    const startBroadcast = async (clientInstance?: any) => {
        const clientToUse = clientInstance || client;
        if (!clientToUse) return;

        try {
            const streamKey = process.env.NEXT_PUBLIC_AWS_IVS_STREAM_KEY;
            if (!streamKey) {
                console.error('Missing stream key');
                return;
            }

            await clientToUse.startBroadcast(streamKey);
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

    useEffect(() => {
        if (!hasJoined) return; // Don't initialize until user clicks Join

        const init = async () => {
            try {
                // Check if we're in a secure context (HTTPS or localhost)
                if (typeof window === 'undefined') {
                    throw new Error('Window is not available');
                }

                // Check if getUserMedia is available
                if (!navigator.mediaDevices) {
                    throw new Error('MediaDevices API is not available. Please use HTTPS or a modern browser.');
                }

                if (!navigator.mediaDevices.getUserMedia) {
                    throw new Error('getUserMedia is not supported. Please use HTTPS or a modern browser.');
                }

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
                    // Get video track to determine natural aspect ratio
                    const videoTrack = stream.getVideoTracks()[0];
                    const settings = videoTrack.getSettings();
                    const naturalWidth = settings.width || 1280;
                    const naturalHeight = settings.height || 720;
                    
                    // Set canvas to match natural camera dimensions
                    canvasRef.current.width = naturalWidth;
                    canvasRef.current.height = naturalHeight;
                    clientInstance.attachPreview(canvasRef.current);
                }

                // Add devices using the stream we already have
                await clientInstance.addVideoInputDevice(stream, 'camera1', { index: 0 });
                await clientInstance.addAudioInputDevice(stream, 'mic1');

            } catch (err: any) {
                console.error('Error initializing stream:', err);
                const errorName = err?.name || '';
                const errorMessage = err?.message || 'Unknown error';
                
                let userMessage = 'Unable to access camera. ';
                
                // Check for specific error types
                if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
                    userMessage = 'Camera permission was denied. Please allow camera access in your browser settings and try again.';
                } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
                    userMessage = 'No camera found. Please ensure a camera is connected and try again.';
                } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
                    userMessage = 'Camera is already in use by another application. Please close other apps using the camera and try again.';
                } else if (!window.isSecureContext) {
                    // Check if accessing via network IP
                    const isNetworkIP = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}/.test(window.location.href) || 
                                       /^https?:\/\/[^/]+\.local/.test(window.location.href);
                    if (isNetworkIP && window.location.protocol === 'http:') {
                        userMessage = 'Camera access requires HTTPS when accessing via network IP. Please use HTTPS or access via localhost. For development, consider using ngrok or setting up HTTPS locally.';
                    } else {
                        userMessage = 'This page must be served over HTTPS (or localhost) to access the camera. Mobile browsers require HTTPS for camera access when accessing via network IP addresses.';
                    }
                } else if (!navigator.mediaDevices) {
                    userMessage = 'Your browser does not support camera access. Please use a modern browser.';
                } else {
                    userMessage += 'Please check your browser permissions and try again.';
                }
                
                alert(userMessage);
            }
        };

        if (typeof window !== 'undefined') {
            init();
        }
    }, [hasJoined]);

    const handleJoin = () => {
        setHasJoined(true);
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

    // Show join screen before camera
    if (!hasJoined) {
        return (
            <div className="fixed inset-0 bg-white flex items-center justify-center">
                <div className="flex flex-col items-center gap-6">
                    <Button
                        onClick={handleJoin}
                        className="rounded-full"
                    >
                        Join Stream
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-white text-white overflow-hidden flex items-center justify-center p-0 md:p-4">
            <div className="relative w-full h-full md:h-[calc(100vh-32px)] md:w-[calc((100vh-32px)*9/16)] md:max-w-full bg-black md:rounded-lg overflow-hidden">
                <canvas
                    ref={canvasRef}
                    className="w-full h-full"
                    style={{ 
                        display: 'block', 
                        width: '100%', 
                        height: '100%', 
                        objectFit: 'cover',
                        objectPosition: 'center'
                    }}
                />
                
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none p-4 z-10">
                    {/* Live indicator - top left */}
                    {isLive && (
                        <div className="absolute top-4 left-4 pointer-events-auto">
                            <Button
                                className="rounded-full"
                            >
                                Streaming Live
                            </Button>
                        </div>
                    )}
                    
                    {/* Start/Stop Streaming button - right side */}
                    <div className="absolute right-4 bottom-4 pointer-events-auto">
                        {!isLive ? (
                            <Button 
                                onClick={() => startBroadcast()} 
                                disabled={!client || !permissionsGranted}
                                className="rounded-full"
                            >
                                Start Streaming
                            </Button>
                        ) : (
                            <Button 
                                onClick={stopBroadcast} 
                                className="rounded-full"
                            >
                                Stop
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
