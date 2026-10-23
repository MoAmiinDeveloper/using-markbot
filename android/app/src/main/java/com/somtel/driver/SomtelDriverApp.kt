package com.somtel.driver

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory

class SomtelDriverApp : Application(), ImageLoaderFactory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.notifier.createChannels()
    }

    /** Coil uses the authenticated OkHttp client so `/api/v1/files/{id}` thumbnails load. */
    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .okHttpClient(container.api.httpClient)
            .crossfade(true)
            .build()
}

val android.content.Context.appContainer: AppContainer
    get() = (applicationContext as SomtelDriverApp).container
