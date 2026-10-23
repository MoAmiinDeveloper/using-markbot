@file:OptIn(ExperimentalMaterial3Api::class)

package com.somtel.driver.ui.signature

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.somtel.driver.AppContainer
import com.somtel.driver.R
import com.somtel.driver.core.Pt
import com.somtel.driver.core.SignaturePad
import com.somtel.driver.core.model.AttachmentKind
import com.somtel.driver.media.MediaFiles
import com.somtel.driver.ui.theme.SomtelColors
import com.somtel.driver.ui.theme.appBarColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/** Customer signature capture: draw with a finger, then save as PNG and queue the upload. */
@Composable
fun SignatureScreen(container: AppContainer, jobId: Long, onDone: () -> Unit) {
    var pad by remember { mutableStateOf(SignaturePad()) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.signature_title)) },
                navigationIcon = {
                    IconButton(onClick = onDone) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = appBarColor(),
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.signature_hint), style = MaterialTheme.typography.bodyMedium)
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(280.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.White)
                    .border(2.dp, SomtelColors.Navy, RoundedCornerShape(12.dp))
                    .clipToBounds()
                    .pointerInput(Unit) {
                        detectTapGestures(onTap = { offset -> pad = pad.startStroke(Pt(offset.x, offset.y)) })
                    }
                    .pointerInput(Unit) {
                        detectDragGestures(
                            onDragStart = { offset -> pad = pad.startStroke(Pt(offset.x, offset.y)) },
                            onDrag = { change, _ ->
                                change.consume()
                                pad = pad.extend(Pt(change.position.x, change.position.y))
                            },
                        )
                    },
            ) {
                val ink = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
                for (stroke in pad.strokes) {
                    if (stroke.isEmpty()) continue
                    if (stroke.size == 1) {
                        drawCircle(color = Color.Black, radius = 2.dp.toPx(), center = Offset(stroke[0].x, stroke[0].y))
                    } else {
                        val path = Path()
                        path.moveTo(stroke[0].x, stroke[0].y)
                        for (i in 1 until stroke.size) path.lineTo(stroke[i].x, stroke[i].y)
                        drawPath(path = path, color = Color.Black, style = ink)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { pad = pad.undo() }, enabled = !pad.isEmpty && !saving) {
                    Text(stringResource(R.string.signature_undo))
                }
                OutlinedButton(onClick = { pad = pad.clear() }, enabled = !pad.isEmpty && !saving) {
                    Text(stringResource(R.string.signature_clear))
                }
            }
            Button(
                onClick = {
                    saving = true
                    val snapshot = pad
                    scope.launch {
                        val file = File(container.uploadsDir, "signature_${UUID.randomUUID()}.png")
                        val ok = withContext(Dispatchers.IO) {
                            try {
                                MediaFiles.renderSignaturePng(snapshot, file)
                                true
                            } catch (_: Throwable) {
                                false
                            }
                        }
                        if (ok) container.repository.addUpload(jobId, file, AttachmentKind.SIGNATURE, "image/png")
                        saving = false
                        onDone()
                    }
                },
                enabled = !pad.isEmpty && !saving,
                colors = ButtonDefaults.buttonColors(containerColor = SomtelColors.Gold, contentColor = SomtelColors.Navy),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
            ) {
                Text(stringResource(R.string.signature_save), fontWeight = FontWeight.Bold)
            }
        }
    }
}
