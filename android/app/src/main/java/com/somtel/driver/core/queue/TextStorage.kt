package com.somtel.driver.core.queue

import java.io.File

/** Minimal persistence abstraction so queue/cache logic can be unit-tested without a device. */
interface TextStorage {
    fun read(): String?
    fun write(text: String)
}

/** Atomic file storage: writes to a temp file then renames over the target. */
class FileTextStorage(private val file: File) : TextStorage {
    override fun read(): String? = try {
        if (file.exists()) file.readText() else null
    } catch (_: Exception) {
        null
    }

    override fun write(text: String) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) {
            file.writeText(text)
            tmp.delete()
        }
    }
}

class InMemoryTextStorage(var value: String? = null) : TextStorage {
    override fun read(): String? = value
    override fun write(text: String) {
        value = text
    }
}
