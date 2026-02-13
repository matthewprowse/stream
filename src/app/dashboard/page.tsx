'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import QRCode from 'qrcode';

// Stream Card Component with Video Preview
function StreamCard({ 
    stream, 
    onPushToJumbotron, 
    onRemoveFromJumbotron 
}: { 
    stream: Stream; 
    onPushToJumbotron: () => void;
    onRemoveFromJumbotron: () => void;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const playerRef = useRef<any>(null);

    useEffect(() => {
        if (!stream.playback_url || stream.status === 'offline') return;

        const initPlayer = async () => {
            if (!videoRef.current || playerRef.current) return;
            
            try {
                const { create, isPlayerSupported } = await import('amazon-ivs-player');
                if (isPlayerSupported && videoRef.current) {
                    const instance = create({
                        wasmWorker: 'https://player.live-video.net/1.48.0/amazon-ivs-wasmworker.min.js',
                        wasmBinary: 'https://player.live-video.net/1.48.0/amazon-ivs-wasmworker.min.wasm',
                    });
                    instance.attachHTMLVideoElement(videoRef.current);
                    playerRef.current = instance;
                    
                    if (stream.playback_url) {
                        instance.load(stream.playback_url);
                        instance.play();
                    }
                }
            } catch (err) {
                console.error('Error initializing player for stream:', err);
            }
        };

        const timeoutId = setTimeout(initPlayer, 100);
        return () => {
            clearTimeout(timeoutId);
            if (playerRef.current) {
                playerRef.current.delete();
                playerRef.current = null;
            }
        };
    }, [stream.playback_url, stream.status]);

    // Update player when playback URL changes
    useEffect(() => {
        if (playerRef.current && stream.playback_url && stream.status !== 'offline') {
            playerRef.current.load(stream.playback_url);
            playerRef.current.play();
        }
    }, [stream.playback_url, stream.status]);

    return (
        <Card className={stream.status === 'on_jumbotron' ? 'border-2 border-red-500' : ''}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                    User ID: {stream.id.substring(0, 8)}...
                </CardTitle>
                {stream.status === 'on_jumbotron' ? (
                    <Badge variant="destructive">ON AIR</Badge>
                ) : (
                    <Badge variant="secondary">LIVE</Badge>
                )}
            </CardHeader>
            <CardContent>
                {stream.playback_url && stream.status !== 'offline' ? (
                    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden mb-2">
                        <video
                            ref={videoRef}
                            className="w-full h-full object-cover"
                            playsInline
                            muted
                            autoPlay
                        />
                    </div>
                ) : (
                    <div className="relative w-full aspect-video bg-gray-200 rounded-lg overflow-hidden mb-2 flex items-center justify-center">
                        <p className="text-gray-400 text-sm">No stream</p>
                    </div>
                )}
                <div className="text-xs text-muted-foreground mt-2">
                    Last Updated: {new Date(stream.updated_at).toLocaleTimeString()}
                </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
                {stream.status !== 'on_jumbotron' && (
                    <Button 
                        className="w-full" 
                        onClick={onPushToJumbotron}
                    >
                        Push to Jumbotron
                    </Button>
                )}
                {stream.status === 'on_jumbotron' && (
                    <>
                        <Button className="w-full" disabled variant="outline">
                            Currently on Jumbotron
                        </Button>
                        <Button 
                            className="w-full" 
                            variant="destructive"
                            onClick={onRemoveFromJumbotron}
                        >
                            Remove from Jumbotron
                        </Button>
                    </>
                )}
            </CardFooter>
        </Card>
    );
}

type Stream = {
    id: string;
    status: 'live' | 'on_jumbotron' | 'offline';
    updated_at: string;
    playback_url?: string;
};

type JumbotronState = {
    mode: 'video' | 'qr' | 'waiting' | null;
    playbackUrl?: string;
    streamId?: string;
};

export default function DashboardPage() {
    const [streams, setStreams] = useState<Stream[]>([]);
    const [jumbotronState, setJumbotronState] = useState<JumbotronState>({ mode: null });
    const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
    const [currentMode, setCurrentMode] = useState<'qr' | 'waiting' | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const playerRef = useRef<any>(null);

    const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

    useEffect(() => {
        // Generate QR Code (black for dashboard preview)
        const generateQR = async () => {
            if (typeof window === 'undefined') return;
            try {
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

        // Fetch jumbotron state
        const fetchJumbotronState = async () => {
            // First check for system row (QR/waiting screens)
            const { data: systemData } = await supabase
                .from('streams')
                .select('id, playback_url, status')
                .eq('id', SYSTEM_ID)
                .eq('status', 'on_jumbotron')
                .maybeSingle();

            if (systemData?.playback_url) {
                if (systemData.playback_url === 'internal:qr') {
                    setJumbotronState({ mode: 'qr', streamId: systemData.id });
                    setCurrentMode('qr');
                    return;
                } else if (systemData.playback_url === 'internal:waiting') {
                    setJumbotronState({ mode: 'waiting', streamId: systemData.id });
                    setCurrentMode('waiting');
                    return;
                }
            }

            // Then check for actual stream on jumbotron
            const { data } = await supabase
                .from('streams')
                .select('id, playback_url, status')
                .eq('status', 'on_jumbotron')
                .neq('id', SYSTEM_ID)
                .maybeSingle();

            if (data?.playback_url) {
                setJumbotronState({ mode: 'video', playbackUrl: data.playback_url, streamId: data.id });
                setCurrentMode(null);
            } else {
                setJumbotronState({ mode: null });
                setCurrentMode(null);
                if (playerRef.current) {
                    playerRef.current.pause();
                }
            }
        };

        // Initial fetch
        const fetchStreams = async () => {
            const { data, error } = await supabase
                .from('streams')
                .select('id, status, updated_at, playback_url')
                .neq('status', 'offline')
                .neq('id', SYSTEM_ID); // Hide system row
            
            if (data) {
                setStreams(data as Stream[]);
            }
            if (error) console.error('Error fetching streams:', error);
        };

        fetchStreams();
        fetchJumbotronState();

        // Subscribe to changes
        const channel = supabase
            .channel('public:streams')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'streams' },
                (payload) => {
                    console.log('Change received!', payload);
                    fetchStreams();
                    fetchJumbotronState();
                }
            )
            .subscribe();

        return () => {
            if (playerRef.current) {
                playerRef.current.delete();
            }
            supabase.removeChannel(channel);
        };
    }, []);

    // Initialize player when video element becomes available
    useEffect(() => {
        if (playerRef.current || typeof window === 'undefined') return;
        
        const initPlayer = async () => {
            if (!videoRef.current || playerRef.current) return;
            try {
                const { create, isPlayerSupported } = await import('amazon-ivs-player');
                if (isPlayerSupported && videoRef.current) {
                    const instance = create({
                        wasmWorker: 'https://player.live-video.net/1.48.0/amazon-ivs-wasmworker.min.js',
                        wasmBinary: 'https://player.live-video.net/1.48.0/amazon-ivs-wasmworker.min.wasm',
                    });
                    instance.attachHTMLVideoElement(videoRef.current);
                    playerRef.current = instance;
                }
            } catch (err) {
                console.error('Error initializing player:', err);
            }
        };
        
        // Small delay to ensure video element is rendered
        const timeoutId = setTimeout(initPlayer, 100);
        return () => clearTimeout(timeoutId);
    }, []); // Only run once on mount

    // Handle video playback when jumbotron state changes
    useEffect(() => {
        const mode = jumbotronState.mode;
        const playbackUrl = jumbotronState.playbackUrl;
        
        if (mode === 'video' && playbackUrl) {
            // Wait for player to be ready
            const loadVideo = async () => {
                if (playerRef.current) {
                    playerRef.current.load(playbackUrl);
                    playerRef.current.play();
                } else {
                    // Retry after a short delay if player isn't ready
                    setTimeout(() => {
                        if (playerRef.current && mode === 'video' && playbackUrl) {
                            playerRef.current.load(playbackUrl);
                            playerRef.current.play();
                        }
                    }, 500);
                }
            };
            loadVideo();
        } else if (mode !== 'video' && playerRef.current) {
            playerRef.current.pause();
        }
    }, [jumbotronState.mode, jumbotronState.playbackUrl || '']);

    const setJumbotronMode = async (mode: 'qr' | 'waiting') => {
        // Toggle off if already active
        if (currentMode === mode) {
            // Set system row to offline to hide it
            await supabase.from('streams').update({ status: 'offline' }).eq('id', SYSTEM_ID);
            return;
        }

        const playbackUrl = mode === 'qr' ? 'internal:qr' : 'internal:waiting';
        
        // 1. Set all real streams to 'live' if they were on jumbotron
        const currentJumbotron = streams.filter(s => s.status === 'on_jumbotron');
        for (const stream of currentJumbotron) {
            await supabase.from('streams').update({ status: 'live' }).eq('id', stream.id);
        }

        // 2. Set System row to on_jumbotron
        await supabase
            .from('streams')
            .upsert({ 
                id: SYSTEM_ID, 
                status: 'on_jumbotron', 
                playback_url: playbackUrl,
                updated_at: new Date().toISOString()
            });
    };

    const removeFromJumbotron = async (targetId: string) => {
        await supabase
            .from('streams')
            .update({ status: 'live' })
            .eq('id', targetId);
    };

    const pushToJumbotron = async (targetId: string) => {
        // Clear system row first - this makes the UI potentially flicker if we depend on it
        // Instead, let's update the target FIRST.
        
        // 1. Set the target to 'on_jumbotron' immediately.
        // This triggers the jumbotron to switch.
        await supabase
            .from('streams')
            .update({ status: 'on_jumbotron' })
            .eq('id', targetId);

        // 2. Set all OTHER 'on_jumbotron' to 'live'
        const currentJumbotron = streams.filter(s => s.status === 'on_jumbotron');
        for (const stream of currentJumbotron) {
            if (stream.id !== targetId) {
                await supabase
                    .from('streams')
                    .update({ status: 'live' })
                    .eq('id', stream.id);
            }
        }
        
        // 3. Clear system row last
        await supabase.from('streams').update({ status: 'offline' }).eq('id', SYSTEM_ID);
    };

    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <h1 className="text-3xl font-bold text-gray-800">Moderator Dashboard</h1>
                <div className="flex gap-2">
                    <Button 
                        onClick={() => setJumbotronMode('qr')} 
                        variant={currentMode === 'qr' ? 'default' : 'outline'}
                    >
                        {currentMode === 'qr' ? 'Hide QR Code' : 'Show QR Code'}
                    </Button>
                    <Button 
                        onClick={() => setJumbotronMode('waiting')} 
                        variant={currentMode === 'waiting' ? 'default' : 'outline'}
                    >
                        {currentMode === 'waiting' ? 'Hide Waiting Screen' : 'Show Waiting Screen'}
                    </Button>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {streams.map((stream) => (
                    <StreamCard
                        key={stream.id}
                        stream={stream}
                        onPushToJumbotron={() => pushToJumbotron(stream.id)}
                        onRemoveFromJumbotron={() => removeFromJumbotron(stream.id)}
                    />
                ))}
                
                {streams.length === 0 && (
                    <div className="col-span-full text-center py-12 text-gray-500">
                        No active streams found. Go to /stream to start one.
                    </div>
                )}
            </div>
        </div>
    );
}
