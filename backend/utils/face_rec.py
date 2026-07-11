import os
import sys
import json
import urllib.request
import cv2
import numpy as np

# Directory for models
MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models')
# Fallback to local sibling models folder in packaged Electron app
if not os.path.exists(os.path.join(MODELS_DIR, 'face_detection_yunet_2023mar.onnx')):
    alt_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
    if os.path.exists(os.path.join(alt_dir, 'face_detection_yunet_2023mar.onnx')):
        MODELS_DIR = alt_dir

YUNET_PATH = os.path.join(MODELS_DIR, 'face_detection_yunet_2023mar.onnx')
SFACE_PATH = os.path.join(MODELS_DIR, 'face_recognition_sface_2021dec.onnx')
ARCFACE_PATH = os.path.join(MODELS_DIR, 'w600k_r50.onnx')

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
ARCFACE_URL = "https://huggingface.co/maze/faceX/resolve/main/w600k_r50.onnx"

def ensure_models():
    if not os.path.exists(MODELS_DIR):
        os.makedirs(MODELS_DIR)
    
    # Download YuNet if missing
    if not os.path.exists(YUNET_PATH):
        print(f"Downloading YuNet face detection model...", file=sys.stderr)
        urllib.request.urlretrieve(YUNET_URL, YUNET_PATH)
        
    # Download SFace if missing (used for landmarks alignment)
    if not os.path.exists(SFACE_PATH):
        print(f"Downloading SFace alignment helper model...", file=sys.stderr)
        urllib.request.urlretrieve(SFACE_URL, SFACE_PATH)

    # Download ArcFace if missing
    if not os.path.exists(ARCFACE_PATH):
        print(f"Downloading ArcFace face recognition model (w600k_r50)... This might take a minute.", file=sys.stderr)
        urllib.request.urlretrieve(ARCFACE_URL, ARCFACE_PATH)

def get_yunet_detector(img_width, img_height):
    detector = cv2.FaceDetectorYN.create(
        model=YUNET_PATH,
        config="",
        input_size=(img_width, img_height),
        score_threshold=0.8,
        nms_threshold=0.3,
        top_k=5000
    )
    return detector

def get_sface_alignment_helper():
    return cv2.FaceRecognizerSF.create(
        model=SFACE_PATH,
        config=""
    )

def get_arcface_net():
    return cv2.dnn.readNetFromONNX(ARCFACE_PATH)

def extract_faces(image_path):
    ensure_models()
    
    img = cv2.imread(image_path)
    if img is None:
        return {"error": f"Failed to load image: {image_path}"}
        
    h, w, _ = img.shape
    detector = get_yunet_detector(w, h)
    aligner = get_sface_alignment_helper()
    arcface_net = get_arcface_net()
    
    _, faces = detector.detect(img)
    
    results = []
    if faces is not None:
        for idx, face in enumerate(faces):
            # Align and crop the face using YuNet landmarks (produces perfectly aligned 112x112 crop)
            aligned_face = aligner.alignCrop(img, face)
            
            # Extract 512-dimensional ArcFace embedding
            blob = cv2.dnn.blobFromImage(aligned_face, 1.0/128.0, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
            arcface_net.setInput(blob)
            feat = arcface_net.forward()
            
            # Normalize embedding vector to unit length (Cosine similarity requirement)
            feat_norm = feat[0] / np.linalg.norm(feat[0])
            
            # Extract bounding box [x, y, w, h] from face detector output
            bbox = face[0:4].astype(int)
            x, y, fw, fh = bbox[0], bbox[1], bbox[2], bbox[3]
            
            # Clamp box to image limits
            x = max(0, x)
            y = max(0, y)
            fw = min(fw, w - x)
            fh = min(fh, h - y)
            
            results.append({
                "faceId": f"face-{idx}-{os.path.basename(image_path)}",
                "vector": feat_norm.tolist(),
                "box": [int(x), int(y), int(fw), int(fh)]
            })
            
    return {"faces": results}

def match_selfie(selfie_path, database_vectors, extra_vectors=[], aligner=None, arcface_net=None):
    ensure_models()
    
    selfie_img = cv2.imread(selfie_path)
    if selfie_img is None:
        return {"error": "Failed to load selfie image"}
        
    h, w, _ = selfie_img.shape
    detector = get_yunet_detector(w, h)
    if aligner is None:
        aligner = get_sface_alignment_helper()
    if arcface_net is None:
        arcface_net = get_arcface_net()
    
    _, faces = detector.detect(selfie_img)
    if faces is None or len(faces) == 0:
        return {"error": "No face detected in your selfie. Please try again with clear face visibility."}
        
    selfie_aligned = aligner.alignCrop(selfie_img, faces[0])
    blob = cv2.dnn.blobFromImage(selfie_aligned, 1.0/128.0, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
    arcface_net.setInput(blob)
    selfie_feat = arcface_net.forward()
    selfie_feat_norm = selfie_feat[0] / np.linalg.norm(selfie_feat[0])
    
    # Normalize any user-verified extra vectors
    extra_norms = []
    for ev in extra_vectors:
        ev_arr = np.array(ev, dtype=np.float32)
        norm = np.linalg.norm(ev_arr)
        if norm > 0:
            extra_norms.append(ev_arr / norm)
            
    def get_matches_for_vector(query_vector, db_vectors, threshold, extra_norms=[]):
        matches = []
        for item in db_vectors:
            db_vector = np.array(item['vector'], dtype=np.float32)
            db_vector_norm = db_vector / np.linalg.norm(db_vector) if np.linalg.norm(db_vector) > 0 else db_vector
            
            # Base similarity to current query_vector
            sim = np.dot(query_vector, db_vector_norm)
            # Compare against any extra verification vectors (max similarity wins)
            for ev in extra_norms:
                sim = max(sim, np.dot(ev, db_vector_norm))
                
            matches.append({
                "photoId": item['photoId'],
                "faceId": item['faceId'],
                "vector": item['vector'],
                "score": float(sim)
            })
        
        filtered = [m for m in matches if m['score'] >= threshold]
        seen_photos = {}
        for m in filtered:
            pid = m['photoId']
            if pid not in seen_photos or m['score'] > seen_photos[pid]['score']:
                seen_photos[pid] = m
                
        sorted_matches = list(seen_photos.values())
        sorted_matches.sort(key=lambda x: x['score'], reverse=True)
        return sorted_matches

    # Step 1: Initial Scan (Threshold 0.35)
    threshold = 0.35
    initial_matches = get_matches_for_vector(selfie_feat_norm, database_vectors, threshold, extra_norms)
    
    # Step 1 Fallback (Adaptive thresholding): if matches < 3, lower threshold by 0.03 to 0.32
    if len(initial_matches) < 3:
        threshold = 0.32
        initial_matches = get_matches_for_vector(selfie_feat_norm, database_vectors, threshold, extra_norms)
        
    # Step 2: Stage 1 Query Expansion (Diverse seeds) if matches >= 3
    if len(initial_matches) >= 3:
        seeds = [initial_matches[0]]
        
        # Max-Min diversity selection of 2nd and 3rd seeds
        remaining = initial_matches[1:15] # scan top 15 candidate matches
        if remaining:
            # Seed 2: lowest dot-product similarity with Seed 1 (most diverse angle/lighting)
            remaining.sort(key=lambda x: np.dot(np.array(x['vector'], dtype=np.float32), np.array(seeds[0]['vector'], dtype=np.float32)))
            seeds.append(remaining[0])
            
            # Seed 3: lowest max similarity to seeds 1 and 2
            if len(remaining) > 1:
                def max_sim_to_seeds(cand):
                    cand_vec = np.array(cand['vector'], dtype=np.float32)
                    return max([np.dot(cand_vec, np.array(s['vector'], dtype=np.float32)) for s in seeds])
                
                remaining = remaining[1:]
                remaining.sort(key=max_sim_to_seeds)
                seeds.append(remaining[0])
                
        # Stage 1 Blended Vector: 35% selfie + 21.6% seeds each
        query_vectors = [selfie_feat_norm] + [np.array(s['vector'], dtype=np.float32) for s in seeds]
        weights = [0.35, 0.216, 0.216, 0.216]
        blended_vector = np.zeros_like(selfie_feat_norm)
        for qv, w in zip(query_vectors, weights):
            blended_vector += qv * w
        blended_vector = blended_vector / np.linalg.norm(blended_vector)
        
        # Run Stage 1 search sweep using blended vector
        stage1_matches = get_matches_for_vector(blended_vector, database_vectors, 0.35, extra_norms)
        
        # Step 3: Stage 2 Deep Query Expansion (Deep seeds selection)
        init_pids = {m['photoId'] for m in initial_matches}
        new_candidates = [m for m in stage1_matches if m['photoId'] not in init_pids]
        
        if len(stage1_matches) >= 5 and len(new_candidates) >= 2:
            # Select 2 additional seeds from new_candidates using Max-Min diversity against current seeds list
            seeds_vectors = [selfie_feat_norm] + [np.array(s['vector'], dtype=np.float32) for s in seeds]
            
            def max_sim_to_all_seeds(cand):
                cand_vec = np.array(cand['vector'], dtype=np.float32)
                return max([np.dot(cand_vec, sv) for sv in seeds_vectors])
                
            new_candidates.sort(key=max_sim_to_all_seeds)
            extra_seed_1 = new_candidates[0]
            seeds_vectors.append(np.array(extra_seed_1['vector'], dtype=np.float32))
            
            new_candidates = new_candidates[1:]
            new_candidates.sort(key=max_sim_to_all_seeds)
            extra_seed_2 = new_candidates[0]
            
            all_seeds = seeds + [extra_seed_1, extra_seed_2]
            
            # Stage 2 Blended Vector: 35% selfie + 13% each of the 5 seeds
            weights = [0.35] + [0.13] * 5
            all_qv = [selfie_feat_norm] + [np.array(s['vector'], dtype=np.float32) for s in all_seeds]
            
            final_vector = np.zeros_like(selfie_feat_norm)
            for qv, w in zip(all_qv, weights):
                final_vector += qv * w
            final_vector = final_vector / np.linalg.norm(final_vector)
            
            # Run final sweep at 0.35 threshold using expanded final vector
            final_matches = get_matches_for_vector(final_vector, database_vectors, 0.35, extra_norms)
            return {
                "matches": [{"photoId": m["photoId"], "score": m["score"]} for m in final_matches],
                "query_expanded": "two-stage",
                "seeds": [s["photoId"] for s in all_seeds],
                "selfie_vector": selfie_feat_norm.tolist()
            }
            
        # Return Stage 1 results if deep expansion wasn't possible
        return {
            "matches": [{"photoId": m["photoId"], "score": m["score"]} for m in stage1_matches],
            "query_expanded": "one-stage",
            "seeds": [s["photoId"] for s in seeds],
            "selfie_vector": selfie_feat_norm.tolist()
        }
        
    return {
        "matches": [{"photoId": m["photoId"], "score": m["score"]} for m in initial_matches],
        "query_expanded": "none",
        "selfie_vector": selfie_feat_norm.tolist()
    }

def verify_anchor(selfie_path, anchor_vector, aligner=None, arcface_net=None):
    ensure_models()
    
    selfie_img = cv2.imread(selfie_path)
    if selfie_img is None:
        return {"verified": False, "error": "Failed to load image"}
        
    h, w, _ = selfie_img.shape
    detector = get_yunet_detector(w, h)
    if aligner is None:
        aligner = get_sface_alignment_helper()
    if arcface_net is None:
        arcface_net = get_arcface_net()
    
    _, faces = detector.detect(selfie_img)
    if faces is None or len(faces) == 0:
        return {"verified": False, "error": "No face detected in your selfie. Please try again with clear face visibility."}
        
    selfie_aligned = aligner.alignCrop(selfie_img, faces[0])
    blob = cv2.dnn.blobFromImage(selfie_aligned, 1.0/128.0, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
    arcface_net.setInput(blob)
    selfie_feat = arcface_net.forward()
    selfie_feat_norm = selfie_feat[0] / np.linalg.norm(selfie_feat[0])
    
    db_vector = np.array(anchor_vector, dtype=np.float32)
    db_vector_norm = db_vector / np.linalg.norm(db_vector) if np.linalg.norm(db_vector) > 0 else db_vector
    similarity = float(np.dot(selfie_feat_norm, db_vector_norm))
    
    # Check threshold (below 0.28 is a reject)
    verified = similarity >= 0.28
    
    if verified:
        return {
            "verified": True,
            "score": similarity,
            "vector": selfie_feat_norm.tolist()
        }
    else:
        return {
            "verified": False,
            "score": similarity,
            "error": "Face does not match the registered user. Please ensure you are capturing your own face."
        }

def cluster_faces(db_vectors):
    if not db_vectors:
        return {"clusters": []}
        
    # 1. Parse and normalize all vectors
    items = []
    for item in db_vectors:
        if "vector" not in item:
            continue
        vec = np.array(item["vector"], dtype=np.float32)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        items.append({
            "photoId": item["photoId"],
            "faceId": item["faceId"],
            "vector": vec
        })
        
    n = len(items)
    if n == 0:
        return {"clusters": []}
        
    # 2. Precompute similarity matrix
    vectors = np.array([x["vector"] for x in items], dtype=np.float32)
    sim_matrix = np.dot(vectors, vectors.T)
    
    # 3. Hub-centric Strict Clique Clustering
    # connection_threshold: similarity required to consider a node as a candidate match to a cluster's leader.
    # clique_threshold: minimum similarity required between *all* members within a cluster to prevent different people (like bride and groom) from merging.
    connection_threshold = 0.54
    clique_threshold = 0.50
    
    # Calculate degree of each node
    degrees = []
    for i in range(n):
        deg = np.sum(sim_matrix[i] >= connection_threshold)
        degrees.append((deg, i))
        
    # Sort by degree descending (hubs first)
    degrees.sort(key=lambda x: x[0], reverse=True)
    
    unclustered = set(range(n))
    clusters = []
    
    for _, leader_idx in degrees:
        if leader_idx not in unclustered:
            continue
            
        current_cluster = [leader_idx]
        unclustered.remove(leader_idx)
        
        # Find candidates similar to the leader
        candidates = []
        for candidate_idx in unclustered:
            if sim_matrix[leader_idx, candidate_idx] >= connection_threshold:
                candidates.append(candidate_idx)
                
        # Sort candidates by similarity to the leader descending
        candidates.sort(key=lambda x: sim_matrix[leader_idx, x], reverse=True)
        
        # Add candidates only if they satisfy complete linkage (clique check)
        for candidate_idx in candidates:
            if candidate_idx not in unclustered:
                continue
                
            is_valid = True
            for member_idx in current_cluster:
                if sim_matrix[candidate_idx, member_idx] < clique_threshold:
                    is_valid = False
                    break
                    
            if is_valid:
                current_cluster.append(candidate_idx)
                unclustered.remove(candidate_idx)
                
        clusters.append(current_cluster)
        
    # 4. Format results
    res_clusters = []
    cluster_idx = 1
    for member_indices in clusters:
        photo_ids = []
        face_ids = []
        for idx in member_indices:
            item = items[idx]
            if item["photoId"] not in photo_ids:
                photo_ids.append(item["photoId"])
            face_ids.append(item["faceId"])
            
        # Only keep clusters that have at least 2 photos (filters out noise)
        if len(photo_ids) >= 2:
            res_clusters.append({
                "id": f"person-{cluster_idx}",
                "photoCount": len(photo_ids),
                "photoIds": photo_ids,
                "faceIds": face_ids
            })
            cluster_idx += 1
            
    # Sort clusters by photo count descending (most frequent people first)
    res_clusters.sort(key=lambda x: x["photoCount"], reverse=True)
    return {"clusters": res_clusters}

def validate_selfie(image_path, aligner=None, arcface_net=None):
    ensure_models()
    
    img = cv2.imread(image_path)
    if img is None:
        return {"error": "Failed to load selfie image."}
        
    h, w, _ = img.shape
    detector = get_yunet_detector(w, h)
    if aligner is None:
        aligner = get_sface_alignment_helper()
    if arcface_net is None:
        arcface_net = get_arcface_net()
    
    _, faces = detector.detect(img)
    
    if faces is None or len(faces) == 0:
        return {"error": "No face detected in your selfie. Please ensure your face is fully visible."}
        
    if len(faces) > 1:
        return {"error": "Multiple faces detected. Please make sure only you are in the frame."}
        
    face = faces[0]
    
    bbox = face[0:4].astype(int)
    x, y, fw, fh = bbox[0], bbox[1], bbox[2], bbox[3]
    
    # 0. Check lighting / brightness
    gray_temp = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    face_roi = gray_temp[max(0, y):min(h, y+fh), max(0, x):min(w, x+fw)]
    if face_roi.size > 0:
        face_brightness = np.mean(face_roi)
        if face_brightness < 45: # 45 out of 255 is very dark
            return {"error": "Poor lighting or image is too dark. Please move to a brighter spot and look directly at the camera."}
    
    # 1. Check size (too far / too close)
    fw_ratio = fw / w
    fh_ratio = fh / h
    
    if fw_ratio < 0.32 or fh_ratio < 0.32:
        return {"error": "You are too far from the camera. Please move closer and align your face inside the stencil."}
        
    if fw_ratio > 0.85 or fh_ratio > 0.85:
        return {"error": "You are too close to the camera. Please move back and align your face inside the stencil."}
        
    # 2. Check alignment/centering (X and Y center offsets)
    face_center_x = x + fw / 2
    face_center_y = y + fh / 2
    
    img_center_x = w / 2
    img_center_y = h / 2
    
    offset_x = abs(face_center_x - img_center_x) / w
    offset_y = abs(face_center_y - img_center_y) / h
    
    if offset_x > 0.25 or offset_y > 0.25:
        return {"error": "Your face is off-center. Please align your face in the middle of the stencil."}
        
    # 3. Check detection confidence (since brightness is checked separately, low confidence means occlusion)
    confidence = face[14] if len(face) > 14 else 1.0
    if confidence < 0.89:
        return {"error": "Face is partially covered or obscured. Please remove any hands, phone, hats, sunglasses, or other accessories, and ensure your face is fully visible."}

    aligned_face = aligner.alignCrop(img, face)
    
    # 4. Check if eyes are closed using aligned eye crop variance and contrast profiles
    # (Checking eye state first protects against distorted landmarks on closed eyes triggering false side angle/tilt errors)
    gray = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2GRAY)
    r_eye = gray[46:58, 20:41]
    l_eye = gray[46:58, 71:92]
    
    r_std = np.std(r_eye)
    l_std = np.std(l_eye)
    
    def get_eye_contrast(eye_patch):
        col_means = np.mean(eye_patch, axis=0)
        col_means_smooth = np.convolve(col_means, np.ones(3)/3, mode='valid')
        center_val = np.min(col_means_smooth[4:13])
        sides_val = (np.mean(col_means_smooth[0:3]) + np.mean(col_means_smooth[14:17])) / 2.0
        return sides_val - center_val

    r_contrast = get_eye_contrast(r_eye)
    l_contrast = get_eye_contrast(l_eye)
    
    if (r_std < 9.2 and r_contrast < 6.5) or (l_std < 9.2 and l_contrast < 6.5):
        return {"error": "Eyes closed detected. Please keep your eyes open and look directly at the camera."}

    # 4.5 Check for sunglasses or shades using eye-to-face relative brightness ratio
    face_skin_mean = np.mean(gray)
    r_eye_mean = np.mean(r_eye)
    l_eye_mean = np.mean(l_eye)
    r_eye_ratio = r_eye_mean / max(face_skin_mean, 1.0)
    l_eye_ratio = l_eye_mean / max(face_skin_mean, 1.0)
    
    if r_eye_ratio < 0.60 or l_eye_ratio < 0.60:
        return {"error": "Sunglasses or shades detected. Please remove your sunglasses and look directly at the camera."}

    # 5. Check for side angle (head turn / yaw) using landmark symmetry
    re_x, re_y = face[4], face[5]  # Right eye (subject's right, left in image)
    le_x, le_y = face[6], face[7]  # Left eye
    nt_x, nt_y = face[8], face[9]  # Nose tip
    
    dist_le = abs(nt_x - le_x)
    dist_re = abs(nt_x - re_x)
    
    min_dist = min(dist_le, dist_re)
    max_dist = max(dist_le, dist_re)
    
    if min_dist < 1.0 or (max_dist / max(min_dist, 0.1)) > 1.7:
        return {"error": "Side angle detected. Please look straight directly at the camera."}
        
    rm_x, rm_y = face[10], face[11] # Right mouth corner
    lm_x, lm_y = face[12], face[13] # Left mouth corner
    
    dist_lm = abs(nt_x - lm_x)
    dist_rm = abs(nt_x - rm_x)
    
    min_mouth = min(dist_lm, dist_rm)
    max_mouth = max(dist_lm, dist_rm)
    
    if min_mouth < 1.0 or (max_mouth / max(min_mouth, 0.1)) > 1.7:
        return {"error": "Side angle detected. Please look straight directly at the camera."}

    # 6. Check for head tilt (roll)
    dy = abs(le_y - re_y)
    dx = abs(le_x - re_x)
    if dx > 0 and (dy / dx) > 0.25:
        return {"error": "Head tilt detected. Please keep your head straight and level."}

    # 7. Check for mouth open too wide (jaw drop)
    dist_eyes = np.sqrt((le_x - re_x)**2 + (le_y - re_y)**2)
    dist_nose_mouth = np.mean([rm_y, lm_y]) - nt_y
    mouth_open_ratio = dist_nose_mouth / max(dist_eyes, 1.0)
    if mouth_open_ratio > 0.88:
        return {"error": "Mouth is open too wide. Please keep your mouth closed or maintain a natural smile."}
        
    blob = cv2.dnn.blobFromImage(aligned_face, 1.0/128.0, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
    arcface_net.setInput(blob)
    feat = arcface_net.forward()
    feat_norm = feat[0] / np.linalg.norm(feat[0])
    
    return {
        "success": True,
        "vector": feat_norm.tolist()
    }

def extract_faces_daemon(image_path, aligner, arcface_net):
    img = cv2.imread(image_path)
    if img is None:
        return {"error": f"Failed to load image: {image_path}"}
        
    h, w, _ = img.shape
    
    # Scale down image for face detection if it's too large (saves massive CPU time)
    max_side = 1000
    longest_side = max(h, w)
    scale = 1.0
    if longest_side > max_side:
        scale = max_side / longest_side
        target_w = int(w * scale)
        target_h = int(h * scale)
        detect_img = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_AREA)
    else:
        detect_img = img
        target_w, target_h = w, h
        
    detector = get_yunet_detector(target_w, target_h)
    _, faces = detector.detect(detect_img)
    
    results = []
    if faces is not None:
        for idx, face in enumerate(faces):
            # Scale landmarks back to original image coordinates
            scaled_face = face.copy()
            if scale < 1.0:
                scaled_face[0:4] = face[0:4] / scale
                scaled_face[4:14] = face[4:14] / scale
                
            # Align and crop the face using original full-resolution image
            aligned_face = aligner.alignCrop(img, scaled_face)
            
            blob = cv2.dnn.blobFromImage(aligned_face, 1.0/128.0, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
            arcface_net.setInput(blob)
            feat = arcface_net.forward()
            feat_norm = feat[0] / np.linalg.norm(feat[0])
            
            bbox = scaled_face[0:4].astype(int)
            x, y, fw, fh = bbox[0], bbox[1], bbox[2], bbox[3]
            x, y, fw, fh = max(0, x), max(0, y), min(fw, w - x), min(fh, h - y)
            
            results.append({
                "faceId": f"face-{idx}-{os.path.basename(image_path)}",
                "vector": feat_norm.tolist(),
                "box": [int(x), int(y), int(fw), int(fh)]
            })
            
    return {"faces": results}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing arguments"}))
        return
        
    cmd = sys.argv[1]
    
    if cmd == "daemon":
        ensure_models()
        aligner = get_sface_alignment_helper()
        arcface_net = get_arcface_net()
        print(json.dumps({"status": "ready"}))
        sys.stdout.flush()
        
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
                action = payload.get("action")
                
                if action == "extract":
                    image_path = payload.get("image_path")
                    res = extract_faces_daemon(image_path, aligner, arcface_net)
                    res["image_path"] = image_path
                    print(json.dumps(res))
                    sys.stdout.flush()
                elif action == "validate":
                    image_path = payload.get("image_path")
                    res = validate_selfie(image_path, aligner, arcface_net)
                    res["image_path"] = image_path
                    print(json.dumps(res))
                    sys.stdout.flush()
                elif action == "verify":
                    image_path = payload.get("image_path")
                    anchor_vector = payload.get("anchor_vector")
                    res = verify_anchor(image_path, anchor_vector, aligner, arcface_net)
                    res["image_path"] = image_path
                    print(json.dumps(res))
                    sys.stdout.flush()
                elif action == "match":
                    selfie_path = payload.get("selfie_path")
                    db_vectors = payload.get("db_vectors")
                    extra_vectors = payload.get("extra_vectors", [])
                    res = match_selfie(selfie_path, db_vectors, extra_vectors, aligner, arcface_net)
                    res["selfie_path"] = selfie_path
                    print(json.dumps(res))
                    sys.stdout.flush()
                elif action == "cluster":
                    db_vectors = payload.get("db_vectors")
                    res = cluster_faces(db_vectors)
                    print(json.dumps(res))
                    sys.stdout.flush()
                elif action == "ping":
                    print(json.dumps({"status": "pong"}))
                    sys.stdout.flush()
                elif action == "exit":
                    break
            except Exception as e:
                print(json.dumps({"error": str(e)}))
                sys.stdout.flush()
        return

    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments"}))
        return

    if cmd == "extract":
        image_path = sys.argv[2]
        res = extract_faces(image_path)
        print(json.dumps(res))
    elif cmd == "validate":
        image_path = sys.argv[2]
        res = validate_selfie(image_path)
        print(json.dumps(res))
    elif cmd == "match":
        selfie_path = sys.argv[2]
        db_json_path = sys.argv[3]
        extra_vectors = []
        if len(sys.argv) > 4:
            try:
                with open(sys.argv[4], 'r', encoding='utf-8') as f:
                    extra_vectors = json.load(f)
            except Exception as e:
                pass
        
        try:
            with open(db_json_path, 'r', encoding='utf-8') as f:
                db_vectors = json.load(f)
            res = match_selfie(selfie_path, db_vectors, extra_vectors)
            print(json.dumps(res))
        except Exception as e:
            print(json.dumps({"error": f"Failed to read database file: {str(e)}"}))
    elif cmd == "verify":
        selfie_path = sys.argv[2]
        anchor_vector_json = sys.argv[3]
        try:
            anchor_vector = json.loads(anchor_vector_json)
            res = verify_anchor(selfie_path, anchor_vector)
            print(json.dumps(res))
        except Exception as e:
            print(json.dumps({"error": f"Failed to parse anchor vector: {str(e)}"}))
    elif cmd == "cluster":
        db_json_path = sys.argv[2]
        try:
            with open(db_json_path, 'r', encoding='utf-8') as f:
                db_vectors = json.load(f)
            res = cluster_faces(db_vectors)
            print(json.dumps(res))
        except Exception as e:
            print(json.dumps({"error": f"Failed to read database file: {str(e)}"}))
            
if __name__ == "__main__":
    main()
