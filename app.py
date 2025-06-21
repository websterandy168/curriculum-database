import os
from dotenv import load_dotenv
import base64
import io
import uuid # For unique filenames
from PIL import Image
load_dotenv()

from flask import Flask, render_template, request, redirect, url_for, flash, session, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from flask_wtf import FlaskForm
from flask_wtf.csrf import CSRFProtect # <-- THIS LINE WAS MISSING
from flask_wtf.file import FileField, FileAllowed
from wtforms import StringField, PasswordField, SubmitField, TextAreaField, SelectField, SelectMultipleField
from wtforms.validators import DataRequired, Optional
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash

# --- App Configuration & Initialization ---
basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
print(f"--- SECRET KEY LOADED: {app.config['SECRET_KEY']} ---")
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'database.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(basedir, 'static/uploads')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
from flask_cors import CORS
# --- Initialize Extensions ---
db = SQLAlchemy(app)
csrf = CSRFProtect(app) # This line now works because of the import
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# --- Database Models ---
task_skill = db.Table('task_skill', db.Column('task_id', db.Integer, db.ForeignKey('task.id')), db.Column('skill_id', db.Integer, db.ForeignKey('skill.id')))
task_standard = db.Table('task_standard', db.Column('task_id', db.Integer, db.ForeignKey('task.id')), db.Column('standard_id', db.Integer, db.ForeignKey('standard.id')))
class User(db.Model, UserMixin): id, username, password_hash = db.Column(db.Integer, primary_key=True), db.Column(db.String(20), unique=True, nullable=False), db.Column(db.String(128))
class Task(db.Model): id, title, description, grade_level, image_path, body_text, skills, standards = db.Column(db.Integer, primary_key=True), db.Column(db.String(200), nullable=False), db.Column(db.Text, nullable=True), db.Column(db.String(50), nullable=False), db.Column(db.String(300), nullable=True), db.Column(db.Text, nullable=False), db.relationship('Skill', secondary=task_skill, backref='tasks'), db.relationship('Standard', secondary=task_standard, backref='tasks')
class Skill(db.Model): id, name = db.Column(db.Integer, primary_key=True), db.Column(db.String(100), unique=True, nullable=False)
class Standard(db.Model): id, name = db.Column(db.Integer, primary_key=True), db.Column(db.String(100), unique=True, nullable=False)
PREDEFINED_GRADES = ["Pre-Kindergarten", "Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade", "6th Grade", "7th Grade", "8th Grade", "9th Grade", "10th Grade", "11th Grade", "12th Grade"]

# --- User Loader & Forms ---
@login_manager.user_loader
def load_user(user_id): return db.session.get(User, int(user_id))
class LoginForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired()]); password = PasswordField('Password', validators=[DataRequired()]); submit = SubmitField('Login')
class TaskForm(FlaskForm):
    title = StringField('Title', validators=[DataRequired()]); description = TextAreaField('Internal Description (optional)'); grade_level = SelectField('Grade Level', choices=PREDEFINED_GRADES, validators=[DataRequired()]); image = FileField('Task Image (optional)', validators=[FileAllowed(['jpg', 'png', 'gif'], 'Images only!')]); body_text = TextAreaField('Task Body (HTML with LaTeX math)', validators=[DataRequired()]); skills = SelectMultipleField('Skills', coerce=int, validators=[Optional()]); standards = SelectMultipleField('Standards', coerce=int, validators=[Optional()]); new_standards = StringField('Or Add New Standards (comma-separated)', validators=[Optional()]); submit = SubmitField('Submit Task')

# --- Routes ---
@app.route('/')
def index():
    query = Task.query; search_grade = request.args.get('grade'); search_skill_id = request.args.get('skill_id'); search_text = request.args.get('q')
    if search_grade: query = query.filter(Task.grade_level == search_grade)
    if search_skill_id: query = query.filter(Task.skills.any(id=search_skill_id))
    if search_text: query = query.filter(Task.title.ilike(f'%{search_text}%'))
    tasks = query.order_by(Task.title).all()
    all_skills = Skill.query.order_by(Skill.name).all(); all_standards = Standard.query.order_by(Standard.name).all()
    builder_task_ids = session.get('builder_tasks', [])
    return render_template('index.html', tasks=tasks, grade_levels=PREDEFINED_GRADES, all_skills=all_skills, all_standards=all_standards, builder_task_ids=builder_task_ids)

@app.route("/login", methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('index'))
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and check_password_hash(user.password_hash, form.password.data):
            login_user(user); return redirect(request.args.get('next') or url_for('index'))
        else: flash('Login Unsuccessful. Please check username and password.', 'danger')
    return render_template('login.html', form=form)

@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/update_builder', methods=['POST'])
def update_builder():
    task_id = request.json.get('task_id')
    if not task_id: return jsonify({'success': False, 'error': 'Missing task_id'}), 400
    if 'builder_tasks' not in session: session['builder_tasks'] = []
    if task_id in session['builder_tasks']: session['builder_tasks'].remove(task_id)
    else: session['builder_tasks'].append(task_id)
    session.modified = True
    return jsonify({'success': True, 'count': len(session['builder_tasks'])})

@app.route('/builder')
def builder():
    builder_task_ids = session.get('builder_tasks', [])
    # Fetch all tasks that are in the builder session
    tasks_in_builder = Task.query.filter(Task.id.in_(builder_task_ids)).all()
    # Create a dictionary for quick lookups: {task_id: task_object}
    tasks_by_id = {task.id: task for task in tasks_in_builder}
    # Reconstruct the tasks list in the exact order from the session.
    # This also implicitly handles cases where a task ID is in the session
    # but the task has been deleted from the database.
    tasks = [tasks_by_id[task_id] for task_id in builder_task_ids if task_id in tasks_by_id]
    worksheet_title = request.args.get('title', 'My Custom Worksheet')
    return render_template('builder.html', tasks=tasks, title=worksheet_title)

@app.route('/add_task', methods=['GET', 'POST'])
@login_required
def add_task():
    form = TaskForm(); form.skills.choices = [(s.id, s.name) for s in Skill.query.order_by('name').all()]; form.standards.choices = [(s.id, s.name) for s in Standard.query.order_by('name').all()]
    if form.validate_on_submit():
        image_file_path = None
        if form.image.data:
            filename = secure_filename(form.image.data.filename); form.image.data.save(os.path.join(app.config['UPLOAD_FOLDER'], filename)); image_file_path = f'uploads/{filename}'
        new_task = Task(title=form.title.data, description=form.description.data, grade_level=form.grade_level.data, image_path=image_file_path, body_text=form.body_text.data) # type: ignore
        for skill_id in form.skills.data: new_task.skills.append(db.session.get(Skill, skill_id))
        for standard_id in form.standards.data: new_task.standards.append(db.session.get(Standard, standard_id))
        if form.new_standards.data:
            for name in [name.strip() for name in form.new_standards.data.split(',')]:
                if name:
                    existing_standard = Standard.query.filter_by(name=name).first()
                    if existing_standard:
                        if existing_standard not in new_task.standards: new_task.standards.append(existing_standard)
                    else: new_standard_obj = Standard(name=name); db.session.add(new_standard_obj); new_task.standards.append(new_standard_obj)
        db.session.add(new_task); db.session.commit(); flash('New task has been successfully created!', 'success')
        return redirect(url_for('index'))
    return render_template('add_task.html', form=form, title="Add New Task")

@app.route('/edit_task/<int:task_id>', methods=['GET', 'POST'])
@login_required
def edit_task(task_id):
    task = db.session.get(Task, task_id); form = TaskForm(obj=task); form.skills.choices = [(s.id, s.name) for s in Skill.query.order_by('name').all()]; form.standards.choices = [(s.id, s.name) for s in Standard.query.order_by('name').all()]
    if form.validate_on_submit():
        task.title = form.title.data; task.description = form.description.data; task.grade_level = form.grade_level.data; task.body_text = form.body_text.data; task.skills.clear(); task.standards.clear() # type: ignore
        for skill_id in form.skills.data: task.skills.append(db.session.get(Skill, skill_id))
        for standard_id in form.standards.data: task.standards.append(db.session.get(Standard, standard_id))
        db.session.commit(); flash('Task has been updated!', 'success'); return redirect(url_for('index'))
    form.skills.data = [skill.id for skill in task.skills]; form.standards.data = [standard.id for standard in task.standards]
    return render_template('edit_task.html', form=form, title="Edit Task", task=task)

@app.route('/delete_task/<int:task_id>', methods=['POST'])
@login_required
def delete_task(task_id):
    task_to_delete = db.session.get(Task, task_id) # type: ignore
    if task_to_delete.image_path:
        try:
            file_path_on_disk = os.path.join(app.root_path, 'static', task_to_delete.image_path)
            if os.path.exists(file_path_on_disk):
                os.remove(file_path_on_disk)
        except Exception as e: print(f"Error deleting file: {e}")
    db.session.delete(task_to_delete); db.session.commit(); flash('Task has been deleted.', 'success')
    return redirect(url_for('index'))

@app.route('/manage', methods=['GET', 'POST'])
@login_required
def manage_tags():
    if request.method == 'POST':
        form_type, name = request.form.get('type'), request.form.get('name')
        if form_type == 'skill' and name and not Skill.query.filter_by(name=name).first(): db.session.add(Skill(name=name))
        elif form_type == 'standard' and name and not Standard.query.filter_by(name=name).first(): db.session.add(Standard(name=name))
        db.session.commit(); return redirect(url_for('manage_tags'))
    all_skills = Skill.query.order_by(Skill.name).all(); all_standards = Standard.query.order_by(Standard.name).all()
    return render_template('manage.html', all_skills=all_skills, all_standards=all_standards)

@app.route('/delete_skill/<int:skill_id>', methods=['POST'])
@login_required
def delete_skill(skill_id):
    db.session.delete(db.session.get(Skill, skill_id)); db.session.commit(); return redirect(url_for('manage_tags')) # type: ignore

@app.route('/delete_standard/<int:standard_id>', methods=['POST'])
@login_required
def delete_standard(standard_id):
    db.session.delete(db.session.get(Standard, standard_id)); db.session.commit(); return redirect(url_for('manage_tags')) # type: ignore

@app.route('/editor')
@login_required
def visual_editor():
    """Serves the visual editor page."""
    return render_template('visual_editor.html', title="Visual Editor")

# New API endpoint for adding tasks from visual editor
@app.route('/api/add_visual_task', methods=['POST'])
@login_required
def add_visual_task():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No JSON data received'}), 400

        title = data.get('title')
        description = data.get('description', '')
        grade_level = data.get('grade_level')
        body_text = data.get('body_text', '')
        image_data_url = data.get('image_data')

        if not all([title, grade_level, image_data_url]):
            return jsonify({'success': False, 'error': 'Missing required fields: title, grade_level, image_data'}), 400

        header, encoded = image_data_url.split(',', 1)
        image_bytes = base64.b64decode(encoded)
        image_format = 'png'
        if 'image/jpeg' in header: image_format = 'jpeg'

        filename = f"{uuid.uuid4()}.{image_format}"
        image_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        with open(image_path, 'wb') as f: f.write(image_bytes)

        new_task = Task(title=title, description=description, grade_level=grade_level, image_path=f'uploads/{filename}', body_text=body_text)
        db.session.add(new_task); db.session.commit()
        return jsonify({'success': True, 'message': 'Task added successfully', 'task_id': new_task.id}), 201
    except Exception as e:
        app.logger.error(f"Error adding visual task: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500

# --- Main Application Runner ---
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True)