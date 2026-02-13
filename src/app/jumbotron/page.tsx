'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';

export default function JumbotronPage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const playerRef = useRef<any>(null);
    const currentStreamIdRef = useRef<string | null>(null);
    const [viewMode, setViewMode] = useState<'video' | 'qr' | 'waiting'>('qr');
    const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

    useEffect(() => {
        // Generate QR Code for the stream page
        const generateQR = async () => {
            if (typeof window === 'undefined') return;
            try {
                // Get the current origin
                const origin = window.location.origin;
                const streamUrl = `${origin}/stream`;
                const url = await QRCode.toDataURL(streamUrl, {
                    width: 400,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });
                setQrCodeUrl(url);
            } catch (err) {
                console.error('Error generating QR code:', err);
            }
        };

        generateQR();

        const init = async () => {
            if (typeof window === 'undefined') return;

            try {
                // Dynamically import the player module
                // @ts-ignore
                const { create, isPlayerSupported } = await import('amazon-ivs-player');
                
                if (isPlayerSupported && videoRef.current && !playerRef.current) {
                    const instance = create({
                        wasmWorker: 'https://player.live-video.net/1.48.0/amazon-ivs-wasmworker.min.js',
                        wasmBinary: 'https://player.live-video.net/1.48.0/amazon-ivs-wasmworker.min.wasm',
                    });
                    
                    instance.attachHTMLVideoElement(videoRef.current);
                    playerRef.current = instance;

                    // Initial load
                    const { data } = await supabase
                        .from('streams')
                        .select('id, playback_url')
                        .eq('status', 'on_jumbotron')
                        .maybeSingle();

                    if (data?.playback_url) {
                        console.log('Initial load:', data.playback_url);
                        if (data.playback_url === 'internal:qr') {
                            setViewMode('qr');
                        } else if (data.playback_url === 'internal:waiting') {
                            setViewMode('waiting');
                        } else {
                            try {
                                currentStreamIdRef.current = data.id;
                                instance.load(data.playback_url);
                                instance.play();
                                setViewMode('video');
                            } catch (e) {
                                console.error("IVS Player load error:", e);
                            }
                        }
                    } else {
                        setViewMode('qr');
                    }
                }
            } catch (err) {
                console.error('Error initializing player:', err);
            }
        };

        init();

        // Subscribe to changes
        const channel = supabase
            .channel('public:streams:jumbotron')
            .on(
                'postgres_changes', 
                { event: 'INSERT', schema: 'public', table: 'streams' },
                (payload) => handleStreamUpdate(payload.new)
            )
            .on(
                'postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'streams' },
                (payload) => handleStreamUpdate(payload.new)
            )
            .subscribe();

        const handleStreamUpdate = (newRow: any) => {
            if (newRow && newRow.status === 'on_jumbotron' && newRow.playback_url) {
                // New stream taking over jumbotron
                console.log('Switching to stream:', newRow.playback_url);
                
                if (newRow.playback_url === 'internal:qr') {
                        if (playerRef.current) playerRef.current.pause();
                        setViewMode('qr');
                        currentStreamIdRef.current = newRow.id; // Allow system row ID tracking
                } else if (newRow.playback_url === 'internal:waiting') {
                        if (playerRef.current) playerRef.current.pause();
                        setViewMode('waiting');
                        currentStreamIdRef.current = newRow.id;
                } else {
                    if (playerRef.current) {
                        currentStreamIdRef.current = newRow.id;
                        playerRef.current.load(newRow.playback_url);
                        playerRef.current.play();
                        setViewMode('video');
                    }
                }
            } else if (newRow && newRow.id === currentStreamIdRef.current && newRow.status !== 'on_jumbotron') {
                // Current stream stopped or moved off jumbotron
                console.log('Current stream off jumbotron, stopping.');
                if (playerRef.current) {
                    playerRef.current.pause();
                }
                currentStreamIdRef.current = null;
                
                // Check if there's another stream taking over jumbotron
                // If not, set waiting screen in database so dashboard knows
                const checkForOtherStream = async () => {
                    const { data } = await supabase
                        .from('streams')
                        .select('id, status')
                        .eq('status', 'on_jumbotron')
                        .maybeSingle();
                    
                    // Only set waiting if no other stream is on jumbotron
                    if (!data) {
                        const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
                        await supabase
                            .from('streams')
                            .upsert({ 
                                id: SYSTEM_ID, 
                                status: 'on_jumbotron', 
                                playback_url: 'internal:waiting',
                                updated_at: new Date().toISOString()
                            });
                    }
                };
                
                // Small delay to allow new stream to be set if switching
                setTimeout(checkForOtherStream, 100);
                setViewMode('waiting'); 
            }
        };

        return () => {
            if (playerRef.current) playerRef.current.delete();
            supabase.removeChannel(channel);
        };
    }, []);

    return (
        <div className="w-screen h-screen bg-white flex items-center justify-center overflow-hidden p-0 md:p-4">
            <div className="relative w-full h-full md:h-[calc(100vh-32px)] md:w-[calc((100vh-32px)*9/16)] md:max-w-full bg-black md:rounded-lg overflow-hidden">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video 
                    ref={videoRef} 
                    className={`w-full h-full object-cover transition-opacity duration-500 ${viewMode === 'video' ? 'opacity-100' : 'opacity-0'}`}
                    playsInline 
                    autoPlay 
                    controls={false}
                />
                
                {viewMode === 'qr' && qrCodeUrl && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                        <img 
                            src={qrCodeUrl} 
                            alt="Stream QR Code" 
                            className="w-[400px] h-[400px]"
                        />
                    </div>
                )}

                {viewMode === 'waiting' && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
                        <h1 className="text-white text-2xl font-semibold animate-pulse">Waiting Screen</h1>
                    </div>
                )}
            </div>
        </div>
    );
}
