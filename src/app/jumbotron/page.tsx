'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import QRCode from 'qrcode';
import Image from 'next/image';

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
                        dark: '#FFFFFF',
                        light: '#00000000' // Transparent background
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
                // DO NOT default back to QR here immediately. 
                // Wait for the new 'on_jumbotron' event to arrive to set the mode.
                // However, if we just stop, the video will freeze.
                // We should probably show waiting or QR as a fallback if no other stream takes over.
                // But since "pushToJumbotron" sets the old one to live/offline BEFORE setting the new one to on_jumbotron,
                // we might see this event first.
                
                // Let's check if there is ANY stream on jumbotron right now?
                // Actually, for smoothness, maybe we just don't auto-switch to QR here.
                // We let the new 'on_jumbotron' event handle the switch.
                
                // But if the stream just ENDED (user stopped streaming), we should go to QR.
                // The issue is distinguishing "switched" vs "ended".
                
                // For now, let's just NOT switch to QR here, but hide the video.
                // If a new stream is coming, it will switch mode to 'video' in milliseconds.
                // If no stream is coming (user stopped), we might want to go to QR.
                
                // Safer bet: Switch to 'waiting' briefly? Or just stay on black video?
                // Let's try switching to 'waiting' as a neutral state.
                setViewMode('waiting'); 
            }
        };

        return () => {
            if (playerRef.current) playerRef.current.delete();
            supabase.removeChannel(channel);
        };
    }, []);

    return (
        <div className="w-screen h-screen bg-black flex flex-col items-center justify-center overflow-hidden relative">
             {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video 
                ref={videoRef} 
                className={`w-full h-full object-contain transition-opacity duration-500 absolute top-0 left-0 ${viewMode === 'video' ? 'opacity-100' : 'opacity-0'}`}
                playsInline 
                autoPlay 
                controls={false}
            />
            
            {viewMode === 'qr' && qrCodeUrl && (
                <div className="z-10 flex flex-col items-center">
                    <h1 className="text-white text-4xl font-bold mb-8 tracking-wider">SCAN TO STREAM</h1>
                    <div className="bg-white p-4 rounded-xl">
                        <Image 
                            src={qrCodeUrl} 
                            alt="Stream QR Code" 
                            width={400} 
                            height={400}
                            className="rounded-lg"
                        />
                    </div>
                </div>
            )}

            {viewMode === 'waiting' && (
                <div className="z-10 flex flex-col items-center">
                    <h1 className="text-white text-4xl font-bold tracking-wider animate-pulse">WAITING FOR STREAM...</h1>
                </div>
            )}
        </div>
    );
}
