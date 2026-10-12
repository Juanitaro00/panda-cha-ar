const clickSound = player.loadAudio('click', 'https://it-dun-pi.vercel.app/assets/audio/select.mp3', (audio) => {
    audio.setLoop(false);
    audio.setVolume(1);
    // audio.play();
});